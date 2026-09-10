"use strict";

// Swift source contracts only; these tests do not execute native audio or iPad UI.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const plugin = fs.readFileSync(path.join(root, "tools/mobile/plugins/tenet-ipad-native/ios/Plugin/TenetNativePlugin.swift"), "utf8");
const voice = fs.readFileSync(path.join(root, "tools/mobile/plugins/tenet-ipad-native/ios/Plugin/TenetVoiceSession.swift"), "utf8");
const packaging = fs.readFileSync(path.join(root, "tools/mobile/build-mobile.js"), "utf8");

function section(source, start, end) {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `Missing section: ${start}`);
  const to = end ? source.indexOf(end, from + start.length) : source.length;
  assert.notEqual(to, -1, `Missing section boundary: ${end}`);
  return source.slice(from, to);
}

test("native voice exports the bounded recognition and playback bridge", () => {
  for (const method of ["getVoiceCapabilities", "startVoiceRecognition", "stopVoiceRecognition", "cancelVoiceRecognition", "speakVoice", "stopSpeaking"]) {
    assert.ok(plugin.includes(`CAPPluginMethod(name: "${method}", returnType: CAPPluginReturnPromise)`));
    assert.ok(plugin.includes(`@objc public func ${method}(_ call: CAPPluginCall)`));
  }
  assert.match(voice, /emit\("voiceTranscript", \["sessionId": sessionId, "text": transcript, "isFinal": isFinal\]\)/);
  assert.match(voice, /\["sessionId": sessionId, "state": state\]/);
});

test("microphone audio has both Apple on-device gates and no cloud, file, or logging lane", () => {
  const capture = section(voice, "private func beginRecording()", "private func stopMicrophone()");
  assert.match(capture, /guard let recognizer, recognizer\.supportsOnDeviceRecognition, recognizer\.isAvailable/);
  assert.match(capture, /request\.requiresOnDeviceRecognition = true/);
  assert.ok(capture.indexOf("request.requiresOnDeviceRecognition = true") < capture.indexOf("recognizer.recognitionTask(with: request)"));
  assert.match(capture, /input\.installTap\(onBus: 0, bufferSize: 1024, format: format\) \{ buffer, _ in\s*request\.append\(buffer\)\s*\}/);
  assert.doesNotMatch(voice, /TenetVoiceSilenceDetector|floatChannelData|silentSeconds|finalTranscriptActivity/);
  assert.doesNotMatch(voice, /requiresOnDeviceRecognition\s*=\s*false|SFSpeechURLRecognitionRequest|URLSession|URLRequest|AVAudioFile|AVAudioRecorder|FileManager|UserDefaults|\.write\(|print\(|NSLog|Logger\(/);
  assert.doesNotMatch(voice, /error\.localizedDescription/);
});

test("capabilities do not prompt and permission callbacks cannot resurrect a cancelled generation", () => {
  const capabilities = section(voice, "func capabilities(locale:", "func start(_ call:");
  assert.doesNotMatch(capabilities, /requestAuthorization|requestRecordPermission|setActive|installTap/);
  assert.match(capabilities, /authority\(\) != nil/);
  assert.match(capabilities, /"supportsSilenceAutoSubmit": false/);
  assert.ok(capabilities.indexOf('result["supportsSilenceAutoSubmit"] = true') > capabilities.indexOf('result["supported"] = true'));
  assert.match(capabilities, /"autoSubmitSilenceSeconds": Self\.transcriptPauseSeconds/);
  assert.match(capabilities, /"autoSubmitTrigger": "transcript-inactivity"/);
  const permissions = section(voice, "private func advancePermissions()", "private func beginRecording()");
  assert.match(permissions, /UIApplication\.shared\.applicationState == \.active/);
  assert.equal((permissions.match(/self\.generation == currentGeneration, self\.phase == \.permissions/g) || []).length, 2);
  const cleanup = section(voice, "private func cleanupRecognition()", "func cancelRecognition(");
  assert.ok(cleanup.indexOf("generation = UUID()") < cleanup.indexOf("recognitionTask?.cancel()"));
  assert.match(cleanup, /transcript = ""/);
  assert.match(cleanup, /recognizer = nil/);
});

test("recording, UTF-16 text, finalization and transient handoff are bounded", () => {
  assert.match(voice, /maximumRecordingSeconds: TimeInterval = 60/);
  assert.match(voice, /finalizationSeconds: TimeInterval = 2/);
  assert.match(voice, /maximumTranscriptCharacters = 1_000/);
  assert.match(voice, /maximumUtteranceCharacters = 4_000/);
  assert.match(voice, /guard units \+ size <= maximumTranscriptCharacters/);
  assert.match(voice, /raw\.utf16\.count <= Self\.maximumUtteranceCharacters/);
  assert.match(voice, /asyncAfter\(deadline: \.now\(\) \+ Self\.maximumRecordingSeconds/);
  assert.match(voice, /asyncAfter\(deadline: \.now\(\) \+ Self\.finalizationSeconds/);
  assert.match(voice, /expiresAt: Date\(\)\.addingTimeInterval\(60\)/);
  const finish = section(voice, "private func beginFinalization(reason:", "private func emitTranscript(");
  assert.ok(finish.indexOf("stopMicrophone()") < finish.indexOf("recognitionTask?.finish()"));
  assert.match(section(voice, "private func stopMicrophone()", "func stop(_ call:"), /removeTap\(onBus: 0\)/);
});

test("native voice keeps session, district and web origin authority without changing auth", () => {
  const authority = section(plugin, "private func voiceAuthority()", "private func nativeVoice()");
  for (const invariant of ["config.valid", "actual.scheme == \"https\"", "actual.host == expected.host", "KeychainStore.read()", "session.profile == profile", "session.baseUrl == baseUrl", "isOpaqueCapability(session.token)", "session.expiresAt > Date().addingTimeInterval(30)"]) {
    assert.ok(authority.includes(invariant), invariant);
  }
  assert.match(voice, /return authority\(\) == expectedAuthority/);
  assert.match(section(voice, "func cancelRecognition(", "func speak(_ call:"), /requestedId != sessionId/);
  assert.match(section(plugin, "@objc public func signOut(", "private func revoke("), /stopNativeVoice\(\)/);
});

test("background, interruption, navigation and teardown retire microphone and playback", () => {
  for (const notification of ["UIApplication.willResignActiveNotification", "UIApplication.didEnterBackgroundNotification", "UIApplication.didBecomeActiveNotification", "AVAudioSession.interruptionNotification"]) {
    assert.ok(voice.includes(notification));
  }
  assert.match(voice, /phase == \.permissions && self\.permissionPromptOutstanding/);
  const interruption = section(voice, "forName: AVAudioSession.interruptionNotification", "forName: AVAudioSession.routeChangeNotification");
  assert.match(interruption, /AVAudioSessionInterruptionTypeKey/);
  assert.match(interruption, /if type == AVAudioSession\.InterruptionType\.began\.rawValue \{ self\?\.cancelAll\(\) \}/);
  assert.match(plugin, /webView\.observe\(\\\.isLoading/);
  assert.match(plugin, /webView\.observe\(\\\.url/);
  assert.doesNotMatch(plugin, /navigationDelegate\s*=/);
  assert.match(voice, /func cancelAll\(\) \{\s*cancelRecognition\(\)\s*stopSpeaking\(\)/);
  const shutdown = section(voice, "func shutdown()");
  assert.match(shutdown, /NotificationCenter\.default\.removeObserver/);
  assert.match(shutdown, /watchdog\?\.invalidate\(\)/);
  assert.match(shutdown, /synthesizer\.delegate = nil/);
  assert.match(shutdown, /cancelRecognition\(\)/);
  assert.match(plugin, /voiceSession\?\.shutdown\(\)/);
});

test("spoken replies use Apple voices, cancel capture, and report actual delegate playback", () => {
  const speak = section(voice, "func speak(_ call:", "func stopSpeaking()");
  const preferred = section(voice, "private static func preferredVoice", "private static func validSessionId");
  assert.match(preferred, /AVSpeechSynthesisVoice\.speechVoices\(\)/);
  assert.match(preferred, /identifier\.hasPrefix\("com\.apple\."\)/);
  assert.match(preferred, /candidate\.split\(separator: "-"\)\.first == language/);
  assert.match(speak, /Self\.preferredVoice\(locale: locale\)/);
  assert.ok(speak.indexOf("cancelRecognition()") < speak.indexOf("synthesizer.speak(next)"));
  assert.doesNotMatch(speak, /emit\("voicePlayback"/);
  const start = section(voice, "didStart utterance:", "func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish");
  assert.match(start, /self\.utterance === utterance/);
  assert.match(start, /self\.emit\("voicePlayback", \["state": "speaking"\]\)/);
  for (const callback of ["didFinish", "didCancel"]) {
    assert.ok(voice.includes(`${callback} utterance: AVSpeechUtterance)`));
  }
  assert.match(voice, /guard utterance === finished else \{ return \}/);
  assert.match(voice, /emit\("voicePlayback", \["state": "stopped"\]\)/);
  assert.match(section(voice, "func start(_ call:", "private func authorityMatches()"), /stopSpeaking\(\)/);
});

test("transcript inactivity normalizes bounded words and ignores repeated or punctuation-only callbacks", () => {
  const normalize = section(voice, "private static func normalizedWords(", "func capabilities(locale:");
  assert.match(normalize, /boundedTranscript\(value\)\.precomposedStringWithCanonicalMapping/);
  assert.match(normalize, /folding\(options: \[\.caseInsensitive\]/);
  assert.match(normalize, /components\(separatedBy: \.punctuationCharacters\)\.joined\(\)/);
  assert.match(normalize, /CharacterSet\.alphanumerics\.union\(\.nonBaseCharacters\)\.inverted/);
  assert.match(normalize, /rangeOfCharacter\(from: \.alphanumerics\) != nil/);
  assert.match(normalize, /joined\(separator: " "\)/);
  const pause = section(voice, "private func updateTranscriptPause()", "private func cancelTranscriptPause()");
  assert.match(voice, /transcriptPauseSeconds: TimeInterval = 1\.5/);
  assert.match(pause, /guard phase == \.listening/);
  assert.match(pause, /let words = Self\.normalizedWords\(transcript\)/);
  assert.match(pause, /guard !words\.isEmpty else \{\s*cancelTranscriptPause\(\)\s*transcriptWords = ""\s*return/);
  assert.match(pause, /guard words != transcriptWords else \{ return \}\s*cancelTranscriptPause\(\)\s*transcriptWords = words/);
  assert.match(pause, /self\.generation == currentGeneration, self\.phase == \.listening/);
  assert.match(pause, /self\.transcriptPauseToken == token, self\.transcriptWords == words/);
  assert.match(pause, /guard self\.authorityMatches\(\), UIApplication\.shared\.applicationState == \.active/);
  assert.match(pause, /beginFinalization\(reason: "transcript-pause"\)/);
  assert.match(pause, /asyncAfter\(deadline: \.now\(\) \+ Self\.transcriptPauseSeconds, execute: deadline\)/);
  assert.doesNotMatch(pause, /Date\(|Timer\(|buffer|sampleRate|rms|peak/);
  const capture = section(voice, "private func beginRecording()", "private func updateTranscriptPause()");
  assert.match(capture, /self\.hasFinalTranscript = result\.isFinal/);
  assert.match(capture, /if result\.isFinal && self\.phase == \.finishing \{ self\.completeRecording\(\); return \}/);
  assert.match(capture, /self\.updateTranscriptPause\(\)/);
  assert.doesNotMatch(capture, /hasFinalTranscript = true|reason: "silence"/);
});

test("manual stop, cancellation and cleanup revoke pending automatic transcript submission", () => {
  const cancel = section(voice, "private func cancelTranscriptPause()", "private func stopMicrophone()");
  assert.match(cancel, /transcriptPauseToken = UUID\(\)/);
  assert.match(cancel, /transcriptPauseDeadline\?\.cancel\(\)/);
  assert.match(cancel, /transcriptPauseDeadline = nil/);
  const stopMic = section(voice, "private func stopMicrophone()", "func stop(_ call:");
  assert.match(stopMic, /cancelTranscriptPause\(\)/);
  assert.match(stopMic, /request\?\.endAudio\(\)/);
  const stop = section(voice, "func stop(_ call:", "private func beginFinalization(reason:");
  assert.match(stop, /guard sessionId == requestedId, phase != nil/);
  assert.match(stop, /if phase == \.permissions \{\s*cancelRecognition\(sessionId: requestedId\)/);
  assert.match(stop, /if phase == \.finishing \{ finalizationReason = "manual" \}\s*beginFinalization\(\)/);
  const cleanup = section(voice, "private func cleanupRecognition()", "func cancelRecognition(");
  assert.match(cleanup, /stopMicrophone\(\)/);
  assert.match(cleanup, /hasFinalTranscript = false/);
  assert.match(cleanup, /transcriptWords = ""/);
  assert.match(cleanup, /finalizationReason = nil/);
});

test("transcript-pause terminal payload requires real final nonempty text or a bounded safe timeout", () => {
  const finish = section(voice, "private func beginFinalization(reason:", "private func emitTranscript(");
  assert.match(finish, /reason: String = "manual"/);
  assert.match(finish, /guard phase == \.listening/);
  assert.match(finish, /guard authorityMatches\(\), UIApplication\.shared\.applicationState == \.active/);
  assert.match(finish, /finalizationReason = reason/);
  assert.match(finish, /emitState\("finalizing", reason: reason\)/);
  assert.match(finish, /if hasFinalTranscript \{ completeRecording\(\); return \}/);
  assert.match(finish, /self\.generation == currentGeneration, self\.phase == \.finishing/);
  const complete = section(voice, "private func completeRecording()", "private func fail(");
  assert.match(complete, /authorityMatches\(\),\s*UIApplication\.shared\.applicationState == \.active/);
  assert.match(complete, /let hasWords = !Self\.normalizedWords\(text\)\.isEmpty/);
  assert.match(complete, /if !hasWords \{\s*completionReason = "no-speech"/);
  assert.match(complete, /else if !hasFinalTranscript \{\s*completionReason = "finalization-timeout"/);
  assert.match(complete, /Nothing was sent automatically\. Review the text and send it manually/);
  assert.match(complete, /emitTranscript\(isFinal: hasFinalTranscript\)/);
  assert.match(complete, /"stopped", message: completionMessage, reason: completionReason,\s*text: text, isFinal: hasFinalTranscript && hasWords/);
  assert.ok(complete.indexOf('text: text, isFinal: hasFinalTranscript && hasWords') < complete.indexOf("cleanupRecognition()"));
  assert.doesNotMatch(complete, /emitTranscript\(isFinal: true\)|hasFinalTranscript = true|completionReason = "transcript-pause"/);
  assert.match(complete, /call\.resolve\(\["text": text, "reason": completionReason\]\)/);
  const state = section(voice, "private func emitState(", "private func completeRecording()");
  assert.match(state, /if let text \{ payload\["text"\] = text \}/);
  assert.match(state, /if let isFinal \{ payload\["isFinal"\] = isFinal \}/);
  assert.match(voice, /beginFinalization\(reason: "max-duration"\)/);
  assert.match(voice, /beginFinalization\(reason: "text-limit"\)/);
});

test("generated iPad privacy descriptions disclose transcript-pause auto-send with scoped image, never audio", () => {
  const info = section(packaging, "function configureIosInfo()", "function ensurePlatform(");
  assert.match(info, /info\.NSMicrophoneUsageDescription = "[^"\n]*Audio is not uploaded or saved\./);
  for (const key of ["NSMicrophoneUsageDescription", "NSSpeechRecognitionUsageDescription"]) {
    const description = info.match(new RegExp(`info\\.${key} = "([^"\\n]*)"`))?.[1];
    assert.ok(description, key);
    assert.match(description, /on this iPad/);
    assert.match(description, /1\.5 seconds without a new transcribed word/);
    assert.doesNotMatch(description, /full seconds of silence/);
    assert.match(description, /automatically sent through your district Gateway/);
    assert.match(description, /selected or visible page image/);
    assert.match(description, /Audio is not uploaded or saved\./);
  }
  assert.match(info, /only transcribed text from your speech/);
  assert.doesNotMatch(info, /UIBackgroundModes|NSUserTrackingUsageDescription/);
});
