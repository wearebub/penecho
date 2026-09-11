# Tenet Whiteboard 1.7.2 qualification

## Scope and cause

The voice submit path previously dismissed its popup and erased the transcript before the shared AI runtime delivered a validated reply. That runtime may handle a guard rejection or Gateway failure internally and return without a reply, so a failed request could silently discard the student's retry context.

This patch retains the popup, transcript, exact selection, and native ink suspension until a validated reply arrives. A request that completes without a reply now keeps its question and displays an explicit unsuccessful-request message with manual retry available. Cancellation still retires the job and ignores late replies.

## Alternatives and unchanged boundaries

Rejected bypassing selection/revision guards, substituting a whole-page image, automatic retry loops, and changing the shared AI request API for all callers. Native speech finality, the 1.5-second transcript-pause timing, district authentication and tutoring rules, and hint routing are unchanged. No dependencies, saved notebook formats, or native capability contracts changed. The package and lockfile version fields move together without npm-install peer-annotation churn.

## Completed pre-release qualification

- Focused voice and selection regression tests: 39 passed.
- Full local check: 1,165 passed, 3 existing skips, no failures.
- Two regressions failed on the prior implementation before passing with the patch. Coverage also checks cancellation and late replies.
- Browser integration with a synthetic native speech bridge: a forced first-request HTTP 403 retained the transcript and enabled retry; retry returned a response using the identical closed lasso polygon, question, and hint action.
- The original physical-iPad first-lasso trigger remains unconfirmed. Browser fixtures do not qualify actual microphone/PencilKit behavior.

## Authorized publication

The user authorized publication after the tested local patch was reported. Dispatch the signed iPad/TestFlight workflow and hosted 1.7.2 archive from the same source commit. Both require full Node 22/24 CI. The hosted archive may name the already-published 1.7.1 build 41 native capability contract while the new native build runs; record the resulting 1.7.2 native identity separately.

Do not replace immutable releases. Preserve 1.7.1 source, IPA, hosted artifacts, and the previous deployment receipt. Record downloaded asset hashes, exact workflow identities, hosted served hashes, rollback backup, and TestFlight upload result under docs/releases. Apple processing and installed-device acceptance must be reported separately.
