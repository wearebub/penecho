import AVFoundation
import Capacitor
import Foundation
import Speech
import UIKit

// All mutable state is confined to the main queue. The audio tap only appends
// to Apple's on-device request; it never copies audio into a file or uploader.
final class TenetVoiceSession: NSObject, AVSpeechSynthesizerDelegate {
    private static let maximumRecordingSeconds: TimeInterval = 60
    private static let finalizationSeconds: TimeInterval = 2
    private static let maximumTranscriptCharacters = 1_000
    private static let maximumUtteranceCharacters = 4_000
    private static let typingFallback = "On-device voice is unavailable. You can still type your question."

    private enum Phase { case permissions, listening, finishing }
    private struct CompletedTranscript {
        let sessionId: String
        let text: String
        let authority: String
        let expiresAt: Date
    }

    private let authority: () -> String?
    private let emit: (String, JSObject) -> Void
    private var observers: [NSObjectProtocol] = []
    private var watchdog: Timer?
    private var generation = UUID()
    private var sessionId: String?
    private var expectedAuthority: String?
    private var phase: Phase?
    private var permissionPromptOutstanding = false
    private var permissionDeadline: Date?
    private var startCall: CAPPluginCall?
    private var stopCalls: [CAPPluginCall] = []
    private var transcript = ""
    private var completed: CompletedTranscript?
    private var recognizer: SFSpeechRecognizer?
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private var engine: AVAudioEngine?
    private var tappedInput: AVAudioInputNode?
    private var recordingDeadline: DispatchWorkItem?
    private var finalizationDeadline: DispatchWorkItem?
    private var ownsAudioSession = false
    private let synthesizer = AVSpeechSynthesizer()
    private var utterance: AVSpeechUtterance?
    private var playbackAuthority: String?
    private var playbackDeadline: Date?
    private var playbackStopRequested = false
    private var closed = false

    init(authority: @escaping () -> String?, emit: @escaping (String, JSObject) -> Void) {
        self.authority = authority
        self.emit = emit
        super.init()
        synthesizer.delegate = self
        observe(UIApplication.willResignActiveNotification) { [weak self] in
            guard let self else { return }
            // System permission sheets may temporarily make the app inactive.
            // No microphone exists yet; actual backgrounding still cancels the
            // pending generation, and capture requires an active app afterward.
            if self.phase == .permissions && self.permissionPromptOutstanding {
                self.stopSpeaking()
            } else {
                self.cancelAll()
            }
        }
        observe(UIApplication.didEnterBackgroundNotification) { [weak self] in self?.cancelAll() }
        observe(UIApplication.didBecomeActiveNotification) { [weak self] in self?.advancePermissions() }
        observe(AVAudioSession.interruptionNotification) { [weak self] in self?.cancelAll() }
        observers.append(NotificationCenter.default.addObserver(
            forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main
        ) { [weak self] notification in
            let reason = (notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? NSNumber)?.uintValue
            if reason == AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue {
                self?.cancelAll()
            }
        })
    }

    deinit { shutdown() }

    private func observe(_ name: Notification.Name, perform: @escaping () -> Void) {
        observers.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { _ in
            perform()
        })
    }

    private static func normalizedLocale(_ value: String?) -> String? {
        let raw = value ?? Locale.current.identifier
        guard raw.utf16.count <= 80 else { return nil }
        let normalized = raw.replacingOccurrences(of: "_", with: "-")
        guard normalized.range(of: "^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$", options: .regularExpression) != nil else {
            return nil
        }
        return normalized
    }

    private static func validSessionId(_ value: String?) -> Bool {
        guard let value else { return false }
        return value.range(of: "^[A-Za-z0-9_-]{1,96}$", options: .regularExpression) != nil
    }

    // The client/server limits are UTF-16 counts, not Swift grapheme counts.
    // Never split a surrogate pair or composed character to reach that bound.
    private static func boundedTranscript(_ value: String) -> String {
        var result = ""
        var units = 0
        for character in value {
            let size = String(character).utf16.count
            guard units + size <= maximumTranscriptCharacters else { break }
            result.append(character)
            units += size
        }
        return result.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    func capabilities(locale: String?) -> JSObject {
        let selected = Self.normalizedLocale(locale)
        var result: JSObject = [
            "supported": false, "onDevice": false,
            "locale": selected ?? Locale.current.identifier.replacingOccurrences(of: "_", with: "-"),
        ]
        guard !closed, authority() != nil else {
            result["reason"] = "Sign in to your configured district to use voice."
            return result
        }
        guard let selected, let candidate = SFSpeechRecognizer(locale: Locale(identifier: selected)) else {
            result["reason"] = Self.typingFallback
            return result
        }
        result["onDevice"] = candidate.supportsOnDeviceRecognition
        guard candidate.supportsOnDeviceRecognition, candidate.isAvailable else {
            result["reason"] = Self.typingFallback
            return result
        }
        let speechPermission = SFSpeechRecognizer.authorizationStatus()
        guard speechPermission != .denied, speechPermission != .restricted,
              AVAudioSession.sharedInstance().recordPermission != .denied else {
            result["reason"] = "Voice permission is disabled in Settings. You can still type your question."
            return result
        }
        result["supported"] = true
        return result
    }

    func start(_ call: CAPPluginCall) {
        guard !closed, phase == nil else {
            call.reject("A voice recording is already active.", "voice_busy")
            return
        }
        guard Self.validSessionId(call.getString("sessionId")), let requestedId = call.getString("sessionId") else {
            call.reject("Provide a short, unique voice session ID.", "voice_session_invalid")
            return
        }
        guard UIApplication.shared.applicationState == .active, let lease = authority() else {
            call.reject("Sign in and keep Tenet open to use voice.", "voice_session_unavailable")
            return
        }
        guard let locale = Self.normalizedLocale(call.getString("locale")),
              let candidate = SFSpeechRecognizer(locale: Locale(identifier: locale)),
              candidate.supportsOnDeviceRecognition, candidate.isAvailable else {
            call.reject(Self.typingFallback, "voice_on_device_unavailable")
            return
        }
        stopSpeaking()
        completed = nil
        generation = UUID()
        sessionId = requestedId
        expectedAuthority = lease
        recognizer = candidate
        transcript = ""
        startCall = call
        phase = .permissions
        permissionDeadline = Date().addingTimeInterval(90)
        startWatchdog()
        advancePermissions()
    }

    private func authorityMatches() -> Bool {
        guard let expectedAuthority else { return false }
        return authority() == expectedAuthority
    }

    private func advancePermissions() {
        guard !closed, phase == .permissions, !permissionPromptOutstanding else { return }
        guard authorityMatches() else { cancelAll(); return }
        guard UIApplication.shared.applicationState == .active else { return }
        let currentGeneration = generation
        switch SFSpeechRecognizer.authorizationStatus() {
        case .authorized:
            break
        case .notDetermined:
            permissionPromptOutstanding = true
            SFSpeechRecognizer.requestAuthorization { [weak self] status in
                DispatchQueue.main.async {
                    guard let self, self.generation == currentGeneration, self.phase == .permissions else { return }
                    self.permissionPromptOutstanding = false
                    guard status == .authorized else {
                        self.fail("Speech permission was not granted. You can still type your question.")
                        return
                    }
                    self.advancePermissions()
                }
            }
            return
        default:
            fail("Speech permission is disabled. You can still type your question.")
            return
        }
        switch AVAudioSession.sharedInstance().recordPermission {
        case .granted:
            beginRecording()
        case .undetermined:
            permissionPromptOutstanding = true
            AVAudioSession.sharedInstance().requestRecordPermission { [weak self] granted in
                DispatchQueue.main.async {
                    guard let self, self.generation == currentGeneration, self.phase == .permissions else { return }
                    self.permissionPromptOutstanding = false
                    guard granted else {
                        self.fail("Microphone permission was not granted. You can still type your question.")
                        return
                    }
                    self.advancePermissions()
                }
            }
        default:
            fail("Microphone permission is disabled. You can still type your question.")
        }
    }

    private func beginRecording() {
        guard authorityMatches(), UIApplication.shared.applicationState == .active else { cancelAll(); return }
        guard let recognizer, recognizer.supportsOnDeviceRecognition, recognizer.isAvailable else {
            fail(Self.typingFallback)
            return
        }
        do {
            let audioSession = AVAudioSession.sharedInstance()
            try audioSession.setCategory(.record, mode: .measurement, options: [])
            try audioSession.setActive(true)
            ownsAudioSession = true
            let engine = AVAudioEngine()
            self.engine = engine
            let input = engine.inputNode
            let format = input.outputFormat(forBus: 0)
            guard format.sampleRate.isFinite, format.sampleRate > 0, format.channelCount > 0 else {
                fail("No microphone is available. You can still type your question.")
                return
            }
            let request = SFSpeechAudioBufferRecognitionRequest()
            // BOTH gates are mandatory. Unsupported devices never fall back to Apple servers.
            request.requiresOnDeviceRecognition = true
            request.shouldReportPartialResults = true
            request.taskHint = .dictation
            self.request = request
            let currentGeneration = generation
            recognitionTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
                DispatchQueue.main.async {
                    guard let self, self.generation == currentGeneration,
                          self.phase == .listening || self.phase == .finishing else { return }
                    guard self.authorityMatches() else { self.cancelAll(); return }
                    if let result {
                        self.transcript = Self.boundedTranscript(result.bestTranscription.formattedString)
                        if result.isFinal { self.completeRecording(); return }
                        self.emitTranscript(isFinal: false)
                        if result.bestTranscription.formattedString.utf16.count >= Self.maximumTranscriptCharacters {
                            self.beginFinalization()
                        }
                    }
                    if error != nil {
                        // Do not expose OS diagnostics: they may contain speech or engine state.
                        self.fail(Self.typingFallback)
                    }
                }
            }
            input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
                request.append(buffer)
            }
            tappedInput = input
            engine.prepare()
            try engine.start()
            phase = .listening
            permissionDeadline = nil
            let deadline = DispatchWorkItem { [weak self] in
                guard let self, self.generation == currentGeneration else { return }
                self.beginFinalization()
            }
            recordingDeadline = deadline
            DispatchQueue.main.asyncAfter(deadline: .now() + Self.maximumRecordingSeconds, execute: deadline)
            let pending = startCall
            startCall = nil
            pending?.resolve()
            emitState("listening")
        } catch {
            fail(Self.typingFallback)
        }
    }

    private func stopMicrophone() {
        engine?.stop()
        if let tappedInput { tappedInput.removeTap(onBus: 0) }
        tappedInput = nil
        engine = nil
        recordingDeadline?.cancel()
        recordingDeadline = nil
        request?.endAudio()
        deactivateAudioIfIdle()
    }

    func stop(_ call: CAPPluginCall) {
        guard let requestedId = call.getString("sessionId"), Self.validSessionId(requestedId) else {
            call.reject("Provide the active voice session ID.", "voice_session_invalid")
            return
        }
        if let completed, completed.sessionId == requestedId,
           completed.expiresAt > Date(), authority() == completed.authority {
            call.resolve(["text": completed.text])
            self.completed = nil
            retireWatchdogIfIdle()
            return
        }
        guard sessionId == requestedId, phase != nil else {
            call.reject("That voice session is no longer active.", "voice_session_mismatch")
            return
        }
        guard authorityMatches() else {
            cancelAll()
            call.reject("The signed-in session changed.", "voice_session_unavailable")
            return
        }
        if phase == .permissions {
            cancelRecognition(sessionId: requestedId)
            call.resolve(["text": ""])
            return
        }
        guard stopCalls.count < 4 else {
            call.reject("Voice is already stopping.", "voice_stopping")
            return
        }
        stopCalls.append(call)
        beginFinalization()
    }

    private func beginFinalization() {
        guard phase == .listening else { return }
        phase = .finishing
        stopMicrophone()
        recognitionTask?.finish()
        let currentGeneration = generation
        let deadline = DispatchWorkItem { [weak self] in
            guard let self, self.generation == currentGeneration, self.phase == .finishing else { return }
            self.completeRecording()
        }
        finalizationDeadline = deadline
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.finalizationSeconds, execute: deadline)
    }

    private func emitTranscript(isFinal: Bool) {
        guard let sessionId else { return }
        emit("voiceTranscript", ["sessionId": sessionId, "text": transcript, "isFinal": isFinal])
    }

    private func emitState(_ state: String, message: String? = nil) {
        guard let sessionId else { return }
        var payload: JSObject = ["sessionId": sessionId, "state": state]
        if let message { payload["message"] = message }
        emit("voiceState", payload)
    }

    private func completeRecording() {
        guard let sessionId, let expectedAuthority, authorityMatches() else { cancelAll(); return }
        let text = transcript
        let pending = stopCalls
        stopCalls.removeAll()
        emitTranscript(isFinal: true)
        emitState("stopped")
        cleanupRecognition()
        // Brief, memory-only handoff for recognizer auto-finalization before Stop.
        // Navigation, sign-out, cancellation, expiry and the next recording erase it.
        completed = CompletedTranscript(
            sessionId: sessionId, text: text, authority: expectedAuthority,
            expiresAt: Date().addingTimeInterval(60)
        )
        for call in pending { call.resolve(["text": text]) }
    }

    private func fail(_ message: String) {
        emitState("error", message: message)
        startCall?.reject(message, "voice_unavailable")
        startCall = nil
        for call in stopCalls { call.reject(message, "voice_unavailable") }
        stopCalls.removeAll()
        completed = nil
        cleanupRecognition()
        retireWatchdogIfIdle()
    }

    private func cleanupRecognition() {
        // Invalidate callbacks BEFORE cancelling Apple's task or resolving callers.
        generation = UUID()
        permissionPromptOutstanding = false
        permissionDeadline = nil
        finalizationDeadline?.cancel()
        finalizationDeadline = nil
        stopMicrophone()
        recognitionTask?.cancel()
        recognitionTask = nil
        request = nil
        recognizer = nil
        sessionId = nil
        expectedAuthority = nil
        phase = nil
        transcript = ""
    }

    func cancelRecognition(sessionId requestedId: String? = nil) {
        // A delayed cancel for an old page must not cancel a newer recording.
        if let requestedId, requestedId != sessionId {
            if completed?.sessionId == requestedId { completed = nil }
            retireWatchdogIfIdle()
            return
        }
        emitState("cancelled")
        startCall?.reject("Voice recording was cancelled.", "voice_cancelled")
        startCall = nil
        for call in stopCalls { call.reject("Voice recording was cancelled.", "voice_cancelled") }
        stopCalls.removeAll()
        completed = nil
        cleanupRecognition()
        retireWatchdogIfIdle()
    }

    func speak(_ call: CAPPluginCall) {
        guard !closed, UIApplication.shared.applicationState == .active, let lease = authority() else {
            call.reject("Sign in and keep Tenet open to hear a reply.", "voice_session_unavailable")
            return
        }
        guard let raw = call.getString("text"), raw.utf16.count <= Self.maximumUtteranceCharacters,
              !raw.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              let locale = Self.normalizedLocale(call.getString("locale")) else {
            call.reject("Provide a reply of at most 4000 characters and a supported language.", "voice_reply_invalid")
            return
        }
        // Use an available Apple system voice, never a third-party voice provider.
        let voices = AVSpeechSynthesisVoice.speechVoices().filter {
            $0.identifier.hasPrefix("com.apple.")
                && $0.language.replacingOccurrences(of: "_", with: "-").lowercased() == locale.lowercased()
        }
        guard let voice = voices.first(where: { $0.quality == .default }) ?? voices.first else {
            call.reject("An on-device voice for this language is unavailable. Read the text reply instead.", "voice_playback_unavailable")
            return
        }
        cancelRecognition()
        stopSpeaking()
        do {
            let audioSession = AVAudioSession.sharedInstance()
            try audioSession.setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
            try audioSession.setActive(true)
            ownsAudioSession = true
            let next = AVSpeechUtterance(string: raw)
            next.voice = voice
            next.rate = AVSpeechUtteranceDefaultSpeechRate
            utterance = next
            playbackAuthority = lease
            playbackDeadline = Date().addingTimeInterval(180)
            playbackStopRequested = false
            startWatchdog()
            synthesizer.speak(next)
            // Playback state comes from the delegate, not this enqueue operation.
            call.resolve()
        } catch {
            deactivateAudioIfIdle()
            call.reject("Spoken reply is unavailable. Read the text reply instead.", "voice_playback_unavailable")
        }
    }

    func stopSpeaking() {
        guard let utterance else { return }
        playbackStopRequested = true
        // Bound cleanup even if an interrupted speech service omits its delegate callback.
        playbackDeadline = Date().addingTimeInterval(1)
        if !synthesizer.stopSpeaking(at: .immediate) {
            finishPlayback(utterance)
        }
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didStart utterance: AVSpeechUtterance) {
        DispatchQueue.main.async { [weak self] in
            guard let self, self.utterance === utterance else { return }
            guard !self.playbackStopRequested, self.authority() == self.playbackAuthority,
                  UIApplication.shared.applicationState == .active else {
                self.stopSpeaking()
                return
            }
            self.emit("voicePlayback", ["state": "speaking"])
        }
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        DispatchQueue.main.async { [weak self] in self?.finishPlayback(utterance) }
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        DispatchQueue.main.async { [weak self] in self?.finishPlayback(utterance) }
    }

    private func finishPlayback(_ finished: AVSpeechUtterance) {
        // A cancelled predecessor cannot mark a newer reply stopped.
        guard utterance === finished else { return }
        utterance = nil
        playbackAuthority = nil
        playbackDeadline = nil
        playbackStopRequested = false
        emit("voicePlayback", ["state": "stopped"])
        deactivateAudioIfIdle()
        retireWatchdogIfIdle()
    }

    private func deactivateAudioIfIdle() {
        guard ownsAudioSession, engine == nil, utterance == nil || playbackStopRequested else { return }
        try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
        ownsAudioSession = false
    }

    private func startWatchdog() {
        guard watchdog == nil else { return }
        let timer = Timer(timeInterval: 1, repeats: true) { [weak self] _ in self?.tick() }
        watchdog = timer
        RunLoop.main.add(timer, forMode: .common)
    }

    private func tick() {
        if phase != nil && !authorityMatches() { cancelAll(); return }
        if let permissionDeadline, permissionDeadline <= Date() { fail("Voice permission timed out. Tap Talk to try again.") }
        if let completed, completed.expiresAt <= Date() || authority() != completed.authority { self.completed = nil }
        if let utterance {
            if playbackStopRequested {
                if let playbackDeadline, playbackDeadline <= Date() { finishPlayback(utterance) }
            } else if authority() != playbackAuthority || (playbackDeadline.map { $0 <= Date() } ?? false) {
                stopSpeaking()
            }
        }
        retireWatchdogIfIdle()
    }

    private func retireWatchdogIfIdle() {
        if phase == nil && utterance == nil && completed == nil {
            watchdog?.invalidate()
            watchdog = nil
        }
    }

    func cancelAll() {
        cancelRecognition()
        stopSpeaking()
    }

    func shutdown() {
        guard !closed else { return }
        closed = true
        for observer in observers { NotificationCenter.default.removeObserver(observer) }
        observers.removeAll()
        watchdog?.invalidate()
        watchdog = nil
        synthesizer.delegate = nil
        synthesizer.stopSpeaking(at: .immediate)
        utterance = nil
        playbackAuthority = nil
        playbackDeadline = nil
        cancelRecognition()
        deactivateAudioIfIdle()
    }
}
