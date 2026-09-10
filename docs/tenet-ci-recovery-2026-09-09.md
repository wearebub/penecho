# Tenet Whiteboard full CI recovery - 2026-09-09

## Qualified source and results

Code commit: `ae100f11c1eb45a6fa8dc31a73b57ceafe8df83b` on `codex/tenet-ipad`.

- [Full CI run](https://github.com/wearebub/penecho/actions/runs/34419653878): successful on Node 22.x and 24.x.
- Each Linux matrix job: 955 tests, 954 passed, zero failed, one existing skip because the sibling PenEcho Cloud checkout is unavailable.
- Local Windows `npm.cmd run check`: 955 tests, 952 passed, zero failed, three existing environment/platform skips (two folder-access/identity cases and the unavailable sibling Cloud checkout). Client bundle parity, vendor parity, and syntax checks also passed.
- Local final log: `C:\Users\caleb\AppData\Local\Temp\tenet-full-check-green-20260909.log`.
- [iOS workflow](https://github.com/wearebub/penecho/actions/runs/34419654134): both required full-CI jobs and the simulator compile succeeded. Signed release was intentionally skipped on this automatic push.

The previous failed runs remain failed historical records. The green results above qualify this code commit, not those earlier commits.

## Root cause and corrections

The previous release relied on focused tests while the full suite was red, and the iOS workflow did not require the full CI matrix. Failures included both real client security-contract regressions and outdated isolated test fixtures.

- Moved native-ink toast styling out of `style.cssText` into `public/tenet-ipad-usability.css`.
- Replaced the comparison UI's generated inline style block with the same-origin `public/tenet-ink-comparison.css` stylesheet, retaining its lifecycle cleanup.
- Updated the exact client source-order contract from 14 to 17 modules and regenerated `public/app.js`.
- Updated capture, mode-switch, resize, save, and unsaved-work fixtures for native ink integration. Added assertions that native flush precedes capture/save, flush refusal stops capture, native-only unsaved work is protected, and touch/Pencil resize targets retain precise mouse behavior.
- Used a real directory junction for the Windows CLI executable-alias fixture instead of a file symlink requiring additional privileges. Real-path identity and deduplication assertions remain enforced.
- Regenerated pinned Visual Explainer vendor files locally to normalize Windows checkout line endings before the full check. No vendor content, dependencies, lockfile changes, or license changes were committed.

Existing CSP and no-inline-style assertions were retained and strengthened. Disabling tests, weakening CSP, accepting focused tests as a replacement for the full suite, and adding Windows privileges were rejected.

## Required iOS gate

`ci.yml` now supports reusable invocation. `ios-release.yml` calls that full Node 22/24 workflow; simulator compilation requires its success, and signed release still requires compilation. A regression test pins this dependency chain and explicit upload authorization. No conditional bypass or `continue-on-error` was added.

Continue using `npm ci` with npm 11.6.2. Do not use bare `npm install`; npm 11 peer-annotation churn is not an intentional dependency change. On a Windows checkout whose pinned vendor-license line endings fail parity, `npm.cmd run build:visual-explainer-vendor` regenerates the canonical local copies without changing dependency versions.

## Hosted client update

The authenticated iPad app loads hosted canvas assets. The client-only corrections were installed separately from the native TestFlight binary.

- Installed: `2026-09-10T00:08:03.316Z` (September 9 local time).
- Hosted source: `ae100f11c1eb45a6fa8dc31a73b57ceafe8df83b`.
- Target: project `tenet-connect-demo`, VM `tenet-gateway-demo`, zone `us-central1-a`, app root `/opt/tenet-demo/penecho`.
- Scope: 23 client files only, including the generated bundle, HTML, three stylesheets, client build script, and 17 client source modules.
- Backup: `/opt/tenet-demo/backups/whiteboard-20260909-ae100f1`.
- Backup receipt: `deployment-receipt.json`, recording previous/new file hashes and newly added files.
- Archive SHA-256: `766de2cf2d1df68cd415aa546e0f5d121dd0501ab297bb425ee494cdacf92e6d`.

Verified public asset SHA-256 values:

| Asset | SHA-256 |
| --- | --- |
| `public/app.js` | `24f6940900ffdeab923456ed813f96ac48cbe960ae02b3ef5f720ee510804952` |
| `public/index.html` | `19b988e0aad1ccb7eb5196741edd19a1b8fdf6efdc050c2464f44704c7dba849` |
| `public/tenet-ink-comparison.css` | `258ea62c8fd40f601731cad1fba0e5a2a798502dff048748575674939d2594d4` |
| `public/tenet-ipad-usability.css` | `1fe17f8773d9776418fd41037a400baf8a10e8d47d2d506cdd2be65f3ce00c31` |
| `public/tenet-notebook.css` | `0402d35b4e56e2c9b8369e5b4b0eb158a137fb38ea659995fc4cc2ce6d5209bc` |

All five assets returned HTTP 200, matching hashes, and `Cache-Control: no-store` on both local serving ports 3888 and 3889. Existing app, authentication, and Caddy processes remained active with unchanged process identities. No service restart was performed.

Two deployment preflight attempts rejected incomplete temporary-helper allowlists before any live writes. The successful attempt used an explicit corrected allowlist and per-file hash checks. No partial deployment was accepted as success.

## Intentionally unchanged and remaining qualification

- TestFlight remains **1.2.0 (18)**, native source `6c460b514c31c6e9281890f337dd49ab46f34c26`. This correction did not upload a new signed build.
- The [build 18 release record](tenet-ipad-build-18-release.md) remains the historical record for that native release and its earlier hosted client state; this note records the subsequent hosted correction.
- Authentication, district Gateway routing, student rules, credentials, signing settings, and notebook data were not changed because this work addresses client CI and release gating.
- Source commits and the per-file hosted backup provide separate recovery points. Native and hosted-client rollback are distinct operations; restoring one does not restore the other.
- No permanent IPA archive or build-18-specific release tag was added here. Existing GitHub artifact retention is not permanent archival.
- Passing tests and simulator compilation do not prove physical-iPad latency, Pencil behavior, or end-to-end notebook compatibility. Those still require device testing.
