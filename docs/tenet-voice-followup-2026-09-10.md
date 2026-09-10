# Talk to Tenet follow-up: recording and word-pause submission

Status: incorporated into the 1.7.0 release candidate. See
`tenet-whiteboard-1.7.md` and `releases/` for qualification and publication
receipts. This note does not supersede the immutable 1.6.0 release records.

## Root causes addressed

- Microphone startup waited for native ink suspension and image/widget preview
  generation. A failed or slow optional preview could therefore prevent
  recording. Talk now starts the native recording path independently; sending
  still requires the authoritative revision-checked image capture.
- Native readiness was cached at initial UI activation. A temporary recognition
  failure or changed permission state could leave microphone controls unusable.
  Each Talk or Record attempt now refreshes native capabilities. Native remains
  the permission and policy authority.
- Talk could become usable before its native event subscriptions were ready.
  The entry point now waits for those subscriptions, not for image generation.
- The previous volume-based detector rejected some valid audio buffers and
  could transcribe speech without detecting a silence interval. At the user's
  explicit request, automatic submission now uses transcription inactivity,
  not microphone volume.
- Successful auto-send depended on two separate notifications arriving in
  order. New native builds include the final transcript in the terminal event.
  The client refuses malformed terminal text rather than reusing an older
  transcript. Older builds retain the original ordered-event fallback.

## Word-pause contract

Native capabilities retain the existing compatibility fields and advertise
`autoSubmitTrigger: "transcript-inactivity"`. After nonempty words arrive, a
changed normalized word sequence restarts a 1.5-second timer. Case, punctuation,
and duplicate-result callbacks alone do not restart it. Room noise does not
control this timer.

Expiry starts native transcription finalization. A successful completion sends
`state: "stopped"`, `reason: "transcript-pause"`, bounded nonempty `text`, and
`isFinal: true` together. Finalization can add latency beyond the word-pause
interval. If recognition does not produce a final result within its bounded
wait, the UI offers review rather than silently sending partial transcription.

Manual Stop listening, cancellation, backgrounding, sign-out, changed page,
stale recording sessions, empty speech and permission failures do not trigger
automatic submission. The visible page or previously circled selection is
recaptured and checked before any request goes to the district Gateway.

## Considered and rejected

- Keeping microphone energy as the auto-send trigger: the user explicitly
  requested a pause in transcribed words instead of acoustic silence.
- Requiring a preview before recording: preview availability is not microphone
  readiness. A missing preview must not hide listening status or prevent typing.
- Treating a partial result as a final result after a timeout: that could send
  an unfinished question. Finalization failure remains visible and reviewable.
- Adding cloud speech or a browser microphone implementation: unnecessary for
  this native iPad fix and would change the existing privacy boundary.

## Intentionally unchanged

Audio stays in the native on-device recognition path. No audio or transcript
storage, new provider, dependency, credential, auth exception, Gateway rule,
notebook schema, or AI output protocol is added. Requests continue using
`hint`. A lasso-scoped voice request never expands to the full page on failure.

## Qualification and rollout

Regression cases were added for nonblocking startup, preview failure, refreshed
readiness, listener readiness, atomic completion, malformed/stale events,
word-pause trigger identity and lasso-only voice submission. Native contract
coverage and permission disclosure wording were updated separately.

Source contracts cannot prove microphone behavior on a physical iPad. Acceptance must
cover granted and denied permissions, short questions, duplicate recognition
callbacks, noisy rooms, stop/cancel/background, and circled versus visible-page
questions.

For a future approved release, deploy the compatible hosted client before
making the new native build available. The client understands both legacy
audio-silence builds and the advertised word-pause trigger. A hosted refresh
alone cannot replace native transcription behavior in an installed iPad app.
