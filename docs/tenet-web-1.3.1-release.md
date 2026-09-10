# Tenet Whiteboard hosted 1.3.1 release record

## Outcome

Published and deployed on 2026-09-10 at 03:29:46 UTC (September 9 in Chicago).
This is a hosted-client hotfix paired with the existing iPad 1.3.0 (25)
TestFlight binary. It is not a new TestFlight upload or an App Store submission.
Save current work and fully reopen the iPad app to load the updated interface.

## Immutable identity

- Source commit: `a2605a2f0e93728e25c5dbf35c9b6cd532f6574d`.
- Branch: `codex/tenet-ipad`.
- Immutable release: https://github.com/wearebub/penecho/releases/tag/tenet-web-v1.3.1
- Release workflow: https://github.com/wearebub/penecho/actions/runs/34433366467
- Paired native release: https://github.com/wearebub/penecho/releases/tag/tenet-ipad-v1.3.0-build.25
- Native workflow remains https://github.com/wearebub/penecho/actions/runs/34430510639.
- The automatic duplicate unsigned native workflow for this client-only push was canceled. No native source changed.

| Artifact | SHA-256 |
| --- | --- |
| `Tenet-Whiteboard-web-1.3.1.tar` | `8ad96ff204b71f3f78fa3b9fe2f83723482c5b726ac6a339b6a52c2418740a45` |
| `release.json` | `e84e180dcbf2fc7d3592f5e3bf07ac2724627c22d79c221269e4a6db27bc0b03` |
| `SHA256SUMS` | `c7220d3a484011b0e13f89b7b7074dabaec4b71a9f54acc688f79421605c87ef` |
| Served `public/app.js` | `95332b9e7ee5d10d8fdab423053f994e33bc1ec99a5b9961965aea41c47b9357` |
| Served `public/tenet-ipad-usability.css` | `84bc9f53c9802ddd7a916e29d9b488e05d9a79c284d241142b9fdbf9f69f17f9` |

GitHub reported the release immutable at the exact source commit. Downloaded
deployment assets were checked against GitHub asset digests before transfer.
The deployment helper separately checked the trusted manifest and archive hashes.
The release also retains a source ZIP; release creation alone did not deploy it.

## Root cause, alternatives, and boundaries

The empty-canvas predicate did not account for native drawing content or ink
activity pending a bridge snapshot. The quick-ask button relied on a toolbar
height offset that became incorrect when native controls wrapped.

The fix tracks native content/activity, refreshes document state, and measures
actual toolbar overlap with the viewport. Runtime CSS variables go through the
existing stylesheet helper to preserve the strict Content Security Policy.

Rejected permanent welcome hiding, a duplicate AI button, a forced toolbar
height, and weakening CSP. Those approaches would respectively break empty-page
guidance, duplicate request behavior, constrain responsive layout, or reduce
security. The initial direct inline-style approach failed the existing strict
style check; it was corrected without weakening that test.

Native Swift, authentication, Gateway routing, AI image payloads, class rules,
notebook schema, and stored student data were intentionally unchanged. This
release does not claim to resolve every remaining notebook UX inconsistency.

## Qualification

- Local generated client build and full check passed: 975 tests, 972 passing, zero failing, three existing skips.
- Release workflow full CI passed on both Node 22 and Node 24.
- Native harness covers first contact, pending snapshots, cancellation, stale sessions, clear, and restored native-only pages.
- Layout harness covers toolbar growth/shrink, right-side viewport clipping, coalescing, native exclusion sync, and lifecycle cleanup.
- Local browser: drawing dismisses welcome; undo restores it on an empty page; redo restores ink; explicit save and reopen preserve content.
- Blank and Grid choices update the paper state.
- Quick-ask measures 48 by 48 CSS pixels and remains below the toolbar in landscape and 768 by 1024 portrait.
- A deliberately unavailable local AI endpoint produced a retry message without a browser console error. This is failure-path coverage, not a live-model quality test.
- Physical Apple Pencil input and full iPad split-view/keyboard acceptance remain device checks. Browser and harness results do not substitute for those.

## Deployment and rollback evidence

Target: project `tenet-connect-demo`, VM `tenet-gateway-demo`, zone
`us-central1-a`, application root `/opt/tenet-demo/penecho`.

- Previous release: `tenet-web-v1.3.0`, commit `e898540f4f735b075e5fd6abbcd1239cfe581361`.
- Previous receipt: `/opt/tenet-demo/backups/whiteboard-1.3.0-e898540/deployment-receipt.json`.
- Backup of pre-deployment client files: `/opt/tenet-demo/backups/whiteboard-1.3.1-a2605a2`.
- Installed receipt: `/opt/tenet-demo/backups/whiteboard-1.3.1-a2605a2/deployment-receipt.json`.
- Local evidence: `%TEMP%\tenet-release-1.3.1-a2605a2\deployment-result.json` and `github-release.json`.

The deploy operation required all 23 existing client paths to match the previous
receipt before writing. It validated archive paths/types, retained old bytes,
and atomically replaced changed files with the generated bundle last.

All five public assets returned HTTP 200 with expected hashes and `no-store`
on both ports 3888 and 3889. Unauthenticated public `/app.js` requests on both
`district.connect.truemadeai.com` and `spanish.connect.truemadeai.com` returned
302. This confirms the authentication boundary remained present, not a fresh
authenticated end-to-end user session.

The deployment checked that these services stayed active with unchanged PIDs:
`penecho-demo` 54543, `tenet-mobile-auth` 60559, and `caddy` 54100. No service
restart or runtime configuration change was performed.

Rollback is a separate authorized operation: restore this deployment's saved
pre-deployment client bytes only after comparing current bytes with this
receipt, then verify served hashes against the previous receipt. Preserve
notebook data and runtime settings. Do not force-move immutable tags or rebuild
an old release from a mutable worktree. A future native rollback still needs
Apple's separate higher-build-number distribution procedure.

## Remaining observed product follow-ups

1. The top Pages action opens the legacy Canvas Library, while the bottom
   Pages & files action opens My notebook. Consolidate these with explicit
   preservation of both existing save paths, rather than hiding a store.
2. After page load, the quick-ask accessible name can revert from Ask the tutor
   to Run Auto AI now. The same manual request handler remains functional.

These were recorded rather than folded into a storage/navigation redesign
during the native-empty-state and toolbar hotfix.
