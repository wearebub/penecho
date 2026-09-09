# Tenet Whiteboard iPad build 18 release

Release date: 2026-09-09. This record supersedes the pending-build status in the
initial native-ink implementation notes.

## Confirmed release identity

| Surface | Identity and evidence |
| --- | --- |
| TestFlight | Tenet Whiteboard 1.2.0 (18) |
| Native source | `6c460b514c31c6e9281890f337dd49ab46f34c26` |
| Hosted client source | `0446c4f0330c9bb4bdb1e8cb439e4f8910de761e` |
| Branch | `codex/tenet-ipad`, pushed to `wearebub/penecho` |
| Hosted workflow | [34417153252](https://github.com/wearebub/penecho/actions/runs/34417153252) |
| Simulator compile | Successful |
| Signed device build and IPA verification | Successful |
| TestFlight upload | Successful at 23:35:06 UTC |
| Apple processing / tester notification | Email confirmed build 18 available to test at 23:36:44 UTC |
| Final hosted-client deployment | 23:47:02 UTC |

The automatic duplicate compile run `34417154076` was canceled. Build 18 came from
the explicitly dispatched signed/upload workflow, not that canceled run.
The two later commits change hosted JavaScript and comparison tests, not Swift
or the signed native application. They do not require a second native binary.

## Why both native and hosted releases were necessary

The iPad shell authenticates and then opens the configured governed Whiteboard
host. Updating the signed application alone does not update that host's client
JavaScript or stylesheets. The hosted bundle still lacked several previously
committed usability changes. It was backed up before replacement.

The main-canvas integration adds a transparent, clipped native PencilKit ink
surface while retaining the existing web document and graph objects. Native
archives and bounded previews are persisted with the local page. AI capture and
export flush pending ink and compose the native layer through the existing
canvas capture path. Gateway routes, prompts, authentication, and student rules
were intentionally not changed.

We rejected replacing the whole document model or converting all ink into
flattened images. Those approaches would lose editable data, change object
behavior, and make a fair fallback comparison difficult. Web remains the default,
and switching engines preserves both layers. Switching does not convert existing
web raster marks into editable PencilKit strokes, or native strokes into editable
Web stroke objects.

## Student-facing controls

1. Update to **1.2.0 (18)** in TestFlight, then reopen Whiteboard. Save existing
   work before closing an older running session.
2. Use **Ink: Web** / **Ink: PencilKit** in the main drawing toolbar. PencilKit
   now draws directly on the notebook, not only in a separate sketch screen.
3. Open **Compare ink**, select the same task for each engine, choose **Start
   trial**, draw, then **Stop and rate**. Repeat with the other engine.
4. Results and subjective ratings stay local. The latest 20 trials are retained;
   **Export JSON locally** exports diagnostics without artwork or account data.
5. Use **Hand** to manipulate web images and graphs. Native tools operate on the
   native ink layer. Web and native layers retain their distinct editing models.

The old badge-level **Pencil studio** button was removed at its owning bootstrap
instead of relying on a timing-sensitive hide operation. The optional **Apple
Pencil sketch** tool remains in the notebook's page tools for deliberately
creating a separate sketch and placing its finished image on the current page.

## Blue-check failure and final reload fix

The standalone sketch failure was in the native-to-web image handoff. The
usability importer was concatenated outside the canvas closure and could not
reach the real canvas image-import function. The older bridge also used
`fetch(data:)` and a synthetic file-input change path. The importer now runs
inside the canvas closure and uses the real import path. A local native-result
fixture successfully placed an image and showed the normal image controls.
This is not a claim that a physical iPad blue-check interaction was tested here.

The comparison reload check found a second integration mismatch: Web reports
`strokeCount: null` because a raster layer has no authoritative stroke inventory,
but the persisted-record validator required a number. Valid Web trial records
were therefore dropped on reload. Explicit null inventories are now accepted,
unknown-endpoint deltas stay null, and malformed numeric values remain refused.
The same previously saved Web and PencilKit trial records both survived reload
after this fix. Unknown stored fields remain excluded from exports.

## Validation performed

```powershell
npm.cmd run build:client
node --check public/app.js
node --test test/tenet-ink-comparison.test.js test/tenet-native-ink.test.js test/mobile-package.test.js test/tenet-branding.test.js test/selection-ui.test.js test/selection.test.js
git diff --check
```

All **41 tests passed**, including seven comparison-persistence regressions.
The hosted native workflow also passed its client consistency check, package
tests, simulator compile, signed-device build, IPA verification, and upload.

Browser checks used loopback-only servers, a fake provider URL, and an explicit
mock native bridge. No real AI/provider requests were used for these checks.
The ordinary Web UI loaded without native controls. The native fixture exercised
renderer switching, trial start/stop, ratings, persistence across reload,
standalone sketch import, and removal of the old Pencil studio badge action.
No browser warnings or errors were reported in those checked flows.

The mock has no actual PencilKit view. It does not qualify native hit testing,
Pencil pressure, real touch sampling, palm rejection, Pencil-to-pixel latency,
or physical on-device ink/graph alignment. Software frame intervals and stroke
timings are deliberately labeled as diagnostics, not hardware latency.

## Hosted deployment and rollback evidence

Target: GCP project `tenet-connect-demo`, VM `tenet-gateway-demo`, zone
`us-central1-a`. Application root: `/opt/tenet-demo/penecho`.

Only 22 client assets/source files were deployed: four public assets,
`scripts/build-client.js`, and `src/client`. No server code, environment files,
credentials, package lockfiles, provider keys, or saved notebook data changed.

Deployment artifact SHA-256:

`7489c1b49fe0fb28a009dfc98df4caa33f76f1d5a836fe2748cbbe5139cd4e4e`

| Public artifact | SHA-256 |
| --- | --- |
| `public/app.js` | `33d3362aab39c0a539464689d767d723da43c5e2c315e362ca80014530d8e33f` |
| `public/index.html` | `19b988e0aad1ccb7eb5196741edd19a1b8fdf6efdc050c2464f44704c7dba849` |
| `public/tenet-ipad-usability.css` | `eebfe6d5f50361d09913848591aac00250fb617dfd4b003cfe4b92bbea880cc3` |
| `public/tenet-notebook.css` | `0402d35b4e56e2c9b8369e5b4b0eb158a137fb38ea659995fc4cc2ce6d5209bc` |

All four resources returned HTTP 200 with matching hashes and `Cache-Control:
no-store` on both hosted application ports, 3888 and 3889. Public unauthenticated
requests to both `district.connect.truemadeai.com/app.js` and
`spanish.connect.truemadeai.com/app.js` still redirected to the existing OAuth
gate. Loopback asset checks are not an authenticated iPad end-to-end AI test.

Services remained active with unchanged PIDs through both client deployments:
`penecho-demo` 54543, `tenet-mobile-auth` 60559, and `caddy` 54100. No service
restart, demo reset, key rotation, or auth bypass was performed.

Backups and per-file deployment receipts remain on the VM:

- `/opt/tenet-demo/backups/whiteboard-20260909-a9387d6`: the original hosted files
  before this release; original bundle SHA-256 was
  `c70a4660a583f202dab37639ef295fdf2593e51677146d6a9304630144d7bf78`.
- `/opt/tenet-demo/backups/whiteboard-20260909-0446c4f`: the initial new client
  before the final comparison-persistence correction.
- Each backup contains `deployment-receipt.json`, including old/new file hashes,
  source identities, the file allowlist, and entries for newly introduced files.

For the next release, archive client files from an exact committed source, hash
the artifact and individual files, compare the live baseline before replacing
anything, back up every affected path, and atomically replace public assets.
Refuse changed baselines or symlinked targets. Keep source and generated bundle
in the same artifact. Do not restart the Gateway just to publish static files.

Rollback requires an explicitly selected receipt. Restore only its listed files
after checking that their current hashes still match the deployed release.
Files whose previous hash is null were newly introduced; remove them only after
the same identity/path checks. Never recursively replace the entire application
root or roll back Gateway/auth/secrets as part of a client rollback.

Use `npm ci` with the recorded npm 11.6.2 convention for future installs. Do not
commit npm-version peer-annotation churn from `npm install`.

## Remaining physical-device acceptance

Repeat the same sentence, fast loops, small math, and graph task with both engines
on the iPad. Include save/reopen, undo/redo, native erasing/lasso, pan/zoom,
switching engines with existing ink, PDF export, and an ordinary governed AI
request after adding new native ink. Confirm that both old and new work are
visible where expected and that no late stroke lands on a different page.
These checks must be recorded from the real device before claiming equivalent
AI visual quality, production-qualified gesture behavior, or superior latency.
