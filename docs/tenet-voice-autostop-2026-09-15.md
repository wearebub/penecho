# Talk to Tenet stops before transcription: bounded diagnosis

Date: 2026-09-15
Status: bounded source patch after the immediate-stop clarification; not tested,
compiled, signed or published in this task.

## Report and delivery boundary

The user clarified that recording stops after approximately 0.1 seconds without
transcription, not that a successfully recognized question is submitted too
early. That excludes the intended 1.5-second word-pause timer and the 5/60-second
deadlines as direct explanations of this immediate stop. The visible terminal
message, audio route, permission state and installed native build still need to
be identified for the failed attempt.

Per the task's release history, commit `1ca27e7` passed unsigned CI but was not
signed or published to TestFlight. Its transcript-retention changes, five-second
native finalization window and eight-second web Stop wait must not be described
as already delivered to the user's iPad. This task did not inspect Git or Apple
release state independently.

## Root-cause conclusion

The exact device cause remains unconfirmed. A concrete immediate cancellation
path existed in the client: every pointer-down outside the Talk group called
`cancel()`, including canvas or palm contact while dictation was starting or
listening. That discarded the active job rather than requiring a deliberate
Stop/Cancel. The patch keeps the Talk controls visible and does not dismiss an
active starting/listening/finalizing job on outside contact. Idle/sending outside
dismissal, explicit Stop/Cancel/Escape and all page/auth/background guards remain.
This is a source-backed accidental-cancellation fix, not proof that the user's
physical iPad followed this path.

Immediate native failures and lifecycle cancellation also previously collapsed
into a generic terminal state. The patch adds fixed, content-free reason codes
to native terminal events and pending start/stop rejections, and displays a
static explanation plus the closed code in the existing Talk status UI. It
preserves an event's reason when a later start rejection arrives, and recognizes
the new codes from a rejection even if it arrives first. No NSError descriptions,
device identifiers, audio samples or transcript logging are added. Existing
method names and successful result shapes are unchanged; older native rejection
codes remain understood by the client.

The 1.5-second word-pause trigger still cannot start before nonempty normalized
transcript words exist. No deadline, finality requirement or retry policy changed.

The required lifecycle docs were read before this diagnosis:
`docs/tenet-ipad-voice.md` and `docs/tenet-voice-followup-2026-09-10.md`.
The latter describes the current transcription-inactivity behavior; the older
voice introduction describes the earlier manual-send experience.

## Source-backed stop paths before the first transcript

| Path | Existing behavior | Source location |
| --- | --- | --- |
| Capability/readiness | A capability request is bounded to 10 seconds. Unsupported on-device recognition or denied permissions returns to typing. | `src/client/app/tenet-voice.js:188` |
| Permission/start wait | Native permission flow is bounded to 90 seconds; the web start call waits 95 seconds when permission is not already granted, otherwise 15 seconds. Native clears the permission deadline after the engine starts. | `TenetVoiceSession.swift:270`, `:401`; `tenet-voice.js:203` |
| No microphone buffers | After engine startup, a 5-second deadline fails if no nonempty PCM buffer confirms input. This is NOT an acoustic-silence or no-transcribed-word deadline. Quiet audio with PCM frames satisfies readiness. | `TenetVoiceSession.swift:389`, `:402`, `:413` |
| Recognition failure | A recognition error before a final result and outside finalization calls `fail`. Without recognized words, there is no transcript to retain. OS error descriptions are deliberately not exposed. | `TenetVoiceSession.swift:374` |
| Recording ceiling | Confirmed microphone input starts the 60-second capture bound. Finalization remains bounded to 5 seconds; empty text ends with `reason: "no-speech"`, never auto-send. | `TenetVoiceSession.swift:419`, `:514`, `:550` |
| Lifecycle/audio-route cancellation | Resign-active, actual backgrounding, audio interruption, disconnected old audio device, authority changes, navigation and sign-out retire capture. Pending native permission sheets receive the existing narrow exception. | `TenetVoiceSession.swift:79`, `:92`, `:99`, `:729`; `tenet-voice.js:97`, `:492` |
| Explicit/dismissal UI cancellation | Before this patch, Cancel, Escape or any outside pointer-down cancelled the job. The patch prevents outside contact from discarding starting/listening/finalizing dictation; explicit controls remain authoritative. The device path is still unconfirmed. | Original `tenet-voice.js:467`, `:470` |

Native source above is
`tools/mobile/plugins/tenet-ipad-native/ios/Plugin/TenetVoiceSession.swift`.
Line numbers describe the pre-patch files read for diagnosis; this patch moves them.

## Terminal evidence added

The existing status line now distinguishes `audio-start-failed`,
`audio-input-unavailable`, `audio-input-timeout`, `audio-input-unconfirmed`,
`audio-engine-stopped`, `recognizer-unavailable`, `recognizer-failed`,
`speech-permission-denied`, `microphone-permission-denied`, `permission-timeout`,
`app-inactive`, `app-background`, `audio-interruption`, `audio-route-changed`,
`authority-changed`, `cancelled`, and `shutdown`. Web-side readiness/start/stop
timeouts have separate fixed labels. Existing no-speech/finalization/recording
limits are also labeled. Unknown codes produce a fixed generic fallback, not OS
diagnostic text. These labels are UI-only and are neither persisted nor uploaded.
Both current and legacy code mappings require own properties. The approved
legacy-lookup correction rejects inherited names such as `toString` and
`__proto__`, as well as non-string codes, instead of treating them as labels.
Known legacy codes keep their existing mappings. This correction was not tested
or otherwise validated in this task.

A native `recognizer-failed` code still does not establish the underlying Apple
service cause. Do not infer an OS error number or claim an engine restart fix.
Visibility/page/sign-out can intentionally dismiss the panel altogether; a label
is not promised to survive a privacy-driven teardown.

## Audio-route consideration, not a verified device cause

Apple documents that input/output sample-rate or channel-count changes can stop
and uninitialize an AVAudioEngine. The current source reacts to interruption and
old-device-unavailable events, but does not subscribe to engine-configuration
changes. That is a possible explanation for stopped input, not proof of this
incident. Automatic engine/task rebuilding would require a separately qualified,
session-bound recovery path that preserves the original capture deadline and
never restarts after cancellation, backgrounding or authority loss.

Reference: [Apple: AVAudioEngineConfigurationChange](https://developer.apple.com/documentation/foundation/nsnotification/name-swift.struct/avaudioengineconfigurationchange).
Apple also requires callers to check recognizer availability and notes that
recognition can fail quickly if the service becomes unavailable:
[Apple: SFSpeechRecognizer](https://developer.apple.com/documentation/speech/sfspeechrecognizer).
Neither reference authorizes cloud fallback; Tenet remains on-device only.

## Considered and rejected

- Removing or lengthening the 1.5-second pause: it is not armed before words exist,
  and changing it would violate the intended user interaction.
- Removing the first-buffer or recording deadlines: this would conceal missing
  input or unavailable recognition behind a permanently listening UI.
- Automatically retrying every recognition or route failure: the cause is unknown;
  a broad retry could restart capture after an intentional lifecycle stop or
  repeatedly extend capture. No such recovery was added speculatively.
- Treating partial or empty recognition as final: it could send an unfinished or
  fabricated question and violates the explicit final-transcript contract.
- Broadly ignoring app lifecycle or delayed native callbacks: that could weaken
  privacy and session authority. Only outside contact during a visibly active Talk
  job is no longer treated as cancellation; explicit dismissal remains available.
- Switching to cloud recognition or saving microphone audio for debugging: both
  would change the on-device privacy boundary.

## Intentionally unchanged

The 1.5-second no-new-words behavior,
real-final-only auto-send, 60-second maximum recording, bounded startup and
finalization, on-device speech gates, mutual exclusion of playback and capture,
auth/page/selection guards and explicit cancellation remain intact. No tests,
fixtures, engineering proposal, dependency, native method names, server,
Gateway policy, version or release file was changed.

Exact changed files:

- `src/client/app/tenet-voice.js`: active-job outside-contact protection and fixed
  terminal status codes, including start-rejection ordering.
- `tools/mobile/plugins/tenet-ipad-native/ios/Plugin/TenetVoiceSession.swift`:
  content-free terminal reasons; lifecycle/engine/recognizer failure paths retain
  their existing stop behavior and generation guards.
- `docs/tenet-voice-autostop-2026-09-15.md`: this diagnosis and delivery boundary.

## Next evidence and delivery requirements

1. Record the installed app/build identifier, whether microphone permission was
   already granted, approximate seconds until stopping, the visible status text,
   and whether headphones/Bluetooth, an interruption or an outside tap was involved.
   After this patch is actually installed, include the closed status code.
   No audio, raw OS diagnostic text, student transcript or credentials are needed.
2. Treat a roughly 5-second first-buffer failure separately from a service error,
   an explicit cancellation, or a 60-second no-transcript ceiling. The displayed
   message and timing are clues, not independent proof of the underlying cause.
3. Include both the prior `1ca27e7` fixes and this patch in an identified signed
   native build and compatible hosted client. Run separately authorized qualification, then sign,
   upload and confirm TestFlight availability. A hosted client refresh or unsigned
   compile alone does not install native speech changes.
4. Qualify the actual native build on a physical iPad: already-granted and first-run
   permissions, short speech, no speech, built-in and supported accessory audio,
   outside canvas/palm contact during startup, duplicate taps, both native
   terminal/rejection event orders, cancel/background/sign-out/page changes, and
   genuine-final pause submission. Update source-extraction fixtures for the new
   helpers without weakening existing lifecycle/finality assertions.
   Do not promise that the retained-transcript fix resolves a no-transcript failure.

No tests, builds, Git operations, signing, publishing, device access or live
student/provider requests were performed in this task.
