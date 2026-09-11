# Tenet Whiteboard 1.7.2 build 44

Status: signed IPA verified; TestFlight upload succeeded at 2026-09-11T16:55:05Z; immutable release assets independently downloaded and hash-verified. Apple processing and physical-iPad acceptance are not independently verified.

- Source: 2864251e589633759a0fb1f7df03a0071940bba6.
- Release: https://github.com/wearebub/penecho/releases/tag/tenet-ipad-v1.7.2-build.44
- Workflow: https://github.com/wearebub/penecho/actions/runs/34624147943
- Annotated tag: 9d77367aa065ff733c9c5228ae7aa54a201de419.
- IPA SHA-256: 340a5edd97b78de00b01c261f3d5b295e602d52817cae8f24e74222d9647e3fc.
- Bundle: ai.truemade.tenet.whiteboard.

## Qualification and scope

Required full CI passed on Node 22 and 24. The unsigned macOS Simulator compile, signed device archive, code-signature verification, TestFlight upload, and immutable archival all succeeded for the same source commit. Local full check: 1,165 passed, 3 existing skips. The packaging assertion was aligned with 1.7.2 after the first release attempt correctly failed its CI gate; no failed-gate IPA was uploaded.

This patch retains voice transcripts and exact selected crops until a validated AI reply. Refused or incomplete requests keep an explicit manual-retry state rather than silently discarding the question. Synthetic browser refusal/retry and focused regressions passed. The original physical-iPad first-lasso trigger remains unconfirmed.

Bypassing crop guards, whole-page fallback, automatic request retries, and changing shared AI request semantics were rejected. Native recording and speech finality, the 1.5-second transcript-pause timer, authentication, district rules, hint routing, and saved notebook formats are unchanged.

## Hosted deployment and rollback

Hosted tenet-web-v1.7.2 is live from the same source commit. See ../tenet-web-v1.7.2 for verified served hashes, protected rollback backup, unchanged service PIDs, and deployment instructions. The hosted artifact names the compatible 1.7.1 build 41 native contract; this new binary is independently versioned and archived.

Prior native 1.7.1 build 41 remains archived. Never move immutable tags, replace IPAs, or reuse build numbers. TestFlight availability of an older build is controlled by Apple; a future rebuild of prior source requires a new build number. No saved-data migration was introduced.

## Device acceptance still required

On a physical iPad, confirm the first lasso-to-voice submission after opening a page, ordinary microphone submission, cancellation, visible failure/retry, and preserved selection scope. Uploaded, processed, available to a tester, and installed are distinct states; this record proves upload and archival, not the latter three.
