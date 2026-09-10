# Native iPad voice questions

## Behavior

Tap **Talk to Tenet**, speak a question such as "Help me start problem 12", and
tap **Ask Tenet**. No circle gesture is required. The panel previews the visible
page and shows the editable transcript. Ask stops recording before submission.
Only the visible page crop and the transcript use the existing authenticated,
district-governed AI request. Off-screen notebook work is not included.

**Read Tenet's reply aloud** is opt-in. The normal canvas answer and its existing
accept/reject controls are retained. **Stop voice** interrupts playback. Only
validated text commands are spoken, not arbitrary HTML, tool payloads, or URLs.
Visual-only answers remain visual; formulas are not promised accessible narration.

## Audio boundary

The native bridge requires on-device speech recognition support. Unsupported
devices/languages or denied permissions fall back to typing, never cloud speech.
Microphone and speech permission requests occur only after an explicit voice
action. There is no always-listening wake word. Audio is neither saved nor sent
through the webview. Transcripts remain ephemeral until explicitly submitted;
submitted text is subject to the Gateway's normal rules and retention policies.
The only stored voice preference is the boolean spoken-reply option.

Recording is bounded, and backgrounding, leaving the page, changing notebooks,
cancelling, or signing out retires the voice session. Playback and recording do
not run together. Native audio must be qualified on physical iPads for supported
languages, permission denial, interruptions, headphones, and classroom noise.

## Engineering decisions

- Root cause: canvas questions previously depended on written/circled input;
  spoken questions need a native transcription lifecycle and explicit page context.
- Rejected a separate AI endpoint, browser speech recognition, and always-on audio:
  these complicate policy enforcement or can move audio off-device unexpectedly.
- Intentionally unchanged: district identity/rules, Gateway routing, crop validation,
  PencilKit/web renderer selection, and existing AI draft acceptance/history.
- A new native binary is required for audio permissions and APIs. Older native
  binaries and Chromebook/web clients do not display the voice controls.

Apple API references: [on-device recognition](https://developer.apple.com/documentation/speech/sfspeechrecognitionrequest/requiresondevicerecognition)
and [speech synthesis](https://developer.apple.com/documentation/avfaudio/avspeechsynthesizer).
