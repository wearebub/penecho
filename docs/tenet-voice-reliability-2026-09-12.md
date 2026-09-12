# Voice reliability and student graph scales, 2026-09-12

## Source findings and changes

- Native transcription finalized with a two-second deadline and deactivated its audio session before the final result. Keep the audio session until cleanup; allow five bounded seconds for a real final result, with an eight-second web Stop deadline. The 1.5-second word-pause trigger itself is unchanged.
- A task error after an already-final transcript could discard the completed question. Preserve the final transcript and existing pause timer; during finishing, retain the bounded final-result wait. Startup and ordinary capture failures still report errors.
- Native errors now hand off bounded reviewable text before cleanup. The web UI also copies valid terminal text on non-final failure/timeout, without treating it as an automatically sendable final result.
- Record again no longer erases the existing question before new words arrive. A second microphone tap no longer discards the active question. The queued close event from a successful reply no longer cancels its playback job.
- Refresh the displayed installed voice name/quality with each capability refresh, including after downloading a better voice.
- New first-quadrant and four-quadrant graph inserts and their previews keep the grid, ticks, arrows, and x/y axis names but omit numeric tick labels and the origin numeral. Existing saved graph images are not rewritten. Polar grids, number lines, and 3D inserts are unchanged.

## Considered and rejected

Do not pretend an unfinished transcript is final, auto-retry a possibly accepted AI request, widen a lasso crop, remove revision/auth guards, or use cloud transcription to conceal an on-device failure. A true timeout still requires review and manual send; the question is retained. Longer finalization can add latency beyond the 1.5-second word pause.

## Intentionally unchanged

Only on-device recognition, the shared hint request pathway, district identity/rules, and scoped image processing remain in use. No audio, transcript, or diagnostic-content persistence, provider, dependency, notebook schema, or release version change is added. These are source-grounded failure paths, not a claimed reproduction of the user's physical-iPad issue.

## Validation and release status

- Targeted voice, native source-contract, and student-scale graph regressions: 57 passed, 0 failed.
- Full local suite with one worker: 1,181 tests, 1,178 passed, 3 skipped, 0 failed.
- Client bundle regenerated with npm run build:client. The standard npm run check reached the full test suite after its syntax/build checks.
- The first full run identified an existing graph test expecting numbered axes; updated it to assert unnumbered axes and unchanged axis positions.
- The next parallel run encountered the pre-existing cloud-connector heartbeat timing failure also seen during 1.7.2 qualification. No relay logic, timeout, or test was weakened; the serial full suite passed. Normal hosted checks remain required.
- Native finalization source-contract expectation updated from 2 seconds to 5 seconds; the transcript word-pause trigger remains 1.5 seconds.
- An unsigned hosted macOS compile is the next qualification step. It does not sign, upload to TestFlight, publish the web application, or prove physical-device behavior.
- No application version bump or new release is included. Existing saved graph images are not rewritten.
