# Lasso voice submission follow-up

## Report and reproduction boundary

The first lasso-to-voice automatic submission was reported as blocked without a visible message. A local browser run with a simulated native speech bridge submitted the first circled question successfully and included only its polygon. The exact physical-iPad trigger has not been reproduced. Do not describe the original device issue as confirmed fixed solely from these tests.

## Confirmed root cause addressed

Voice submission closed its popup, discarded its transcript, and resumed native ink before `requestAI` accepted or answered the request. The shared request function intentionally handles some guard failures and Gateway errors internally and can return without a validated reply. The voice caller treated that return as success, leaving no retained question or visible retry state in the popup.

The popup now retains the transcript and exact selection, with native ink suspended, until the existing validated-response callback fires. A return without a reply leaves the popup open with an explicit unsuccessful-request message and allows manual retry. Cancel, page changes, and sign-out still retire the request and erase ephemeral text.

## Considered and rejected

- Do not remove revision or generation checks, or replace a stale selected crop with the visible page. Those checks prevent sending unintended student work.
- Do not automatically retry rejected requests. A policy or authorization refusal must not become a retry loop or bypass.
- Do not add a second speech recorder, loosen native finality, or alter the 1.5-second transcript-pause contract without evidence that those caused this report.
- Do not make all shared AI callers throw errors solely to repair the voice popup. Keep the fix in the voice caller and use its existing validated-reply callback.

## Intentionally unchanged

Native speech recognition, district routing and rules, hint/Socratic behavior, crop construction and stale-selection checks, direct microphone entry, and the normal visual AI response pipeline remain unchanged. Transcripts are not added to persistent storage or diagnostic logs.

## Regression coverage

Two new tests fail against the prior source: a declined first lasso auto-submit loses its popup/transcript; a queued request clears the question before any validated reply. Coverage also checks a same-scope hint retry and cancellation with a late response. Publication and physical-device acceptance are separate from local qualification.

## Qualification completed

- Focused voice and selection tests: 39 passed, 0 failed.
- Full `npm.cmd run check`: 1,168 tests; 1,165 passed, 3 skipped, 0 failed.
- `npm.cmd run build:client` completed and regenerated the client bundle.
- Browser integration used the real application with a synthetic native speech bridge and a local synthetic Gateway. The first lasso voice request received HTTP 403. The popup stayed open with its transcript, a visible unsuccessful-request message, and an enabled Ask Tenet retry button.
- Manual retry produced a response and closed the popup. Both captured requests used the hint action, identical question text, and the identical closed seven-point lasso polygon.
- The initial first-lasso success path also worked in the browser fixture. This does not reproduce or establish the cause of the reported physical-iPad first-attempt failure. Real microphone, PencilKit hardware, and installed TestFlight behavior remain unverified for this patch.
- No shared AI request semantics, district rules, crop/revision authorization guards, or native recording/finality timing were changed. Automatic request retry was intentionally not introduced.
- This is a local tested patch only. No new version, commit, tag, deployment, or TestFlight upload was performed for this patch.