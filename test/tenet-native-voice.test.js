"use strict";

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
  assert.match(capture, /input\.installTap\(onBus: 0, bufferSize: 1024, format: format\) \{ buffer, _ in\s*request\.append\(buffer\)/);
  assert.doesNotMatch(voice, /requiresOnDeviceRecognition\s*=\s*false|SFSpeechURLRecognitionRequest|URLSession|URLRequest|AVAudioFile|AVAudioRecorder|FileManager|UserDefaults|\.write\(|print\(|NSLog|Logger\(/);
  assert.doesNotMatch(voice, /error\.localizedDescription/);
});

test("capabilities do not prompt and permission callbacks cannot resurrect a cancelled generation", () => {
  const capabilities = section(voice, "func capabilities(locale:", "func start(_ call:");
  assert.doesNotMatch(capabilities, /requestAuthorization|requestRecordPermission|setActive|installTap/);
  assert.match(capabilities, /authority\(\) != nil/);
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
  const finish = section(voice, "private func beginFinalization()", "private func emitTranscript(");
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
  assert.match(speak, /AVSpeechSynthesisVoice\.speechVoices\(\)/);
  assert.match(speak, /identifier\.hasPrefix\("com\.apple\."\)/);
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

test("generated iPad privacy descriptions disclose local transcription and explicit Gateway send", () => {
  const info = section(packaging, "function configureIosInfo()", "function ensurePlatform(");
  assert.match(info, /info\.NSMicrophoneUsageDescription = "[^"\n]*Audio is not uploaded or saved\./);
  assert.match(info, /info\.NSSpeechRecognitionUsageDescription = "[^"\n]*review the text[^"\n]*Ask Tenet[^"\n]*district Gateway/);
  assert.doesNotMatch(info, /UIBackgroundModes|NSUserTrackingUsageDescription/);
});
