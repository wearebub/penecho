# Talk automatic-start root cause

Status: source fix only. No tests, bundle generation, native build, commit, or
publication performed for this follow-up. Physical iPad acceptance is pending.

## Root cause and path comparison

Both the microphone entry button and Record again already reach the same
`record(value)` function and `native.startVoiceRecognition` bridge method.
There is no separate transcription engine for automatic startup.

The opening path performs additional popup setup before calling that recorder:

1. `cancel()` clears the old job and paints Record again as disabled.
2. `open()` assigns a new job and shows the dialog.
3. `positionPopover()` calls `runtimeElementStyle(ui.dialog)` without a key.
4. The helper in `src/client/app/core.js` explicitly returns null when its key
   argument is absent. The following `style.setProperty(...)` therefore throws.
5. Execution never reaches the initial paint, job watcher, or recorder.

This explains the reported workaround. Typing dispatches the input listener,
which calls `paint()` with the new job present and enables Record again. That
button calls the recorder directly without positioning the popup, so native
capture and transcription can work.

The existing voice test harness does not implement `getBoundingClientRect` or
the runtime styling helper. The positioning function returns early in that
harness, so the automatic-start tests never exercised the failing branch.
Those tests were read for investigation, not modified or run in this follow-up.

## Changes

- Supply the stable `tenet-voice-popover` key to the existing CSP-safe styling
  helper and handle a null return when no runtime stylesheet is available.
- Paint controls, install the job watcher, and invoke the shared recorder before
  optional popup positioning and asynchronous preview generation.
- Isolate unexpected positioning errors from microphone startup without
  overriding the recorder's status or removing cancellation controls.

## Considered and rejected

- Replacing the native recorder or changing permission handling: working Record
  again uses the same native bridge, and the opening path has a deterministic
  JavaScript failure before that bridge call.
- Simulating a Record again click: both paths already share the recorder;
  synthetic clicks would hide rather than fix the startup exception.
- Adding arbitrary delays or requiring a first typed character: neither fixes
  the missing style key, and both make the broken workaround part of the UX.
- Weakening CSP or changing the shared styling helper to accept missing keys:
  keyed stylesheet rules are an existing shared contract. Fix its caller.

## Intentionally unchanged

Native capture/transcription, audio privacy, authenticated session checks,
district routing, selected-image scope, minimum-hint requests, and the 1.5-second
transcribed-word pause are unchanged here. Earlier pending hit-area and native
startup-recovery changes are preserved; those are separate from this root cause.

## Qualification still required

Exercise the actual microphone entry click with DOM geometry and a helper that
requires a key. Compare native start calls with Record again, including no
stylesheet, a thrown positioning error, typing, cancellation during startup,
and selected-area voice. Update the regression fixtures for the earlier pending
startup-timeout/audio-ack changes before running the suite. Then build and
qualify the release, and confirm automatic startup on an actual iPad without
typing or pressing Record again first.
