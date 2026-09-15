# Tenet Whiteboard 1.11.1: relative and clock-time playback labels

Released 2026-09-15 from `d384a649ead548acc86e7ec3421502fa2e330ff9`.

## Delivery

- Hosted runtime: https://github.com/wearebub/penecho/releases/tag/tenet-web-v1.11.1 . The annotated tag and release artifacts are immutable.
- Hosted release workflow: https://github.com/wearebub/penecho/actions/runs/35030296238 . Both required Node 22 and Node 24 CI jobs passed before archival.
- Public teacher viewer: https://wearebub.github.io/penecho/ . Workflow https://github.com/wearebub/penecho/actions/runs/35030298308 passed and deployed. Its source receipt, HTML, JavaScript, and CSS were checked against the release manifest.
- District and Spanish app endpoints received the verified overlay at `2026-09-15T22:22:33.536Z`. Forty managed runtime files were qualified; exactly four changed: `public/app.js`, `public/tenet-history-viewer.js`, `public/tenet-process.css`, and `src/client/app/tenet-process-ui.js`.
- Automatic unsigned iPad Simulator compile also passed for this source: https://github.com/wearebub/penecho/actions/runs/35030296624 .
- Paired native release remains **1.11.0 (51)**, `tenet-ipad-v1.11.0-build.51`. No native code changed and no new signed IPA or TestFlight build was published. Fully closing and reopening the existing app loads the hosted update. Physical-device uptake has not been verified.

## What changed and why

The root cause was presentation: recorded timestamps already existed, but were buried in event details and there was no prominent recorded-span summary. Teacher view now displays the first-to-last recorded span, first and last clock times, and both relative and timezone-qualified clock labels on work moments, AI interactions, selected observations, checkpoints, and graph endpoints.

Relative time starts at the first retained observation, not the notebook creation date, export date, save date, or expected assignment duration. Playback speed and skipped pauses never alter these labels. The elapsed calculation uses absolute timestamps across timezone offsets and daylight-saving transitions. Missing or backward timestamps disable the elapsed span rather than inventing or sorting observations. Empty, single-event, equal-time, fractional, multi-day, and incomplete histories are labeled explicitly.

Rejected alternatives: estimating active effort from elapsed time, using accelerated replay duration as assignment duration, or assigning an authorship/misconduct verdict from a short recorded window. The displayed span includes pauses and AI wait time. It is not proof of complete assignment coverage, effort, or off-platform activity. Clock labels use the viewer's timezone and the recording device's clock, not server-attested timestamps.

Intentionally unchanged: capture and retention, raw event ordering, AI request grouping, prompts and district rules, authentication, native code, exported file formats, PDF generation, and LMS integration. Batch review and embedding history inside a PDF remain separate future work. Existing `.tenet` files remain readable without migration.

## Qualification

- Local canonical `npm.cmd run check`: **1,422 passed, zero failed, three existing skips**, 1,425 total. The optional actual exported-file fixture was enabled with `TENET_SUBMISSION_ARTIFACT`.
- Focused UI suite: **97 passed**, including ten new timing regressions. Two older assertions were updated for the deliberately changed time text and graph accessibility label; behavior and request-linking checks remain enforced.
- New coverage includes a five-minute span independent of save metadata; 8x replay and pause skipping; no/single/equal timestamps; missing and backward clocks without event reordering; the New York daylight-saving fallback; epoch, subsecond and multi-day durations; shared AI-relative origins; gap warnings; sign-out cleanup; and responsive, non-verdict timing controls.
- Built application and standalone bundles passed the canonical generated-source parity check. No generated bundle was hand-edited. Package and lockfile changes are version metadata only; no dependency was installed or changed.
- The real built standalone viewer was exercised in a browser at 1280x720 under same-origin external-script/style CSP. The synthetic sample displayed `2m 12s`, timezone-qualified endpoints, and relative event labels. DOM inspection and screenshot review confirmed the timing summary rendered. No real student file was uploaded and no AI call was made. The temporary local server and test tab were closed.
- Hosted installation verified no-store served hashes on ports 3888 and 3889, readiness, and 302 responses at both protected public entry points. Service PIDs remained 192062 (Whiteboard), 78226 (mobile auth), and 54100 (Caddy). District policy and the installed dependency-lock hash were unchanged; no restart was needed.

## Artifact and rollback evidence

| Artifact | SHA-256 |
| --- | --- |
| Hosted runtime TAR | `6df88fb4ad081cc90ea3f9bb5c892051f03a250ac1115e8e07f48c4bc24df4ce` |
| Hosted release manifest | `787f826ac76ff2d238708a81e6845427ea473122cd6a2acecfad7140814694af` |
| Served application JS | `3364fb1efa7ef2b11703df442edf9ce490dcc196b4dec8b3917324c766b2f6cf` |
| Teacher viewer JS | `6450c786fdb7f8060d125937b83770f3f3fd3765024b946e31d92ca2c2a03b2a` |
| Teacher viewer CSS | `d58297a6a6675230f3ffd9408fab7fa0340deae123a389d125686dfcb683c4db` |

Machine-readable evidence is in `tenet-whiteboard-1.11.1-deployment.json` and `tenet-whiteboard-1.11.1-viewer.json` beside this file. The protected VM backup is `/opt/tenet-demo/backups/whiteboard-1.11.1-d384a64`; the prior installed source is 1.11.0, `f973ea707462e4b9f5ef7120b8d8dab63e6e6ff2`.

The backup retains the deployment script, config, manifest, previous/next bytes, and receipt. Its guarded `rollback` mode restores the prior hosted files only when subsequent-drift checks permit it. Do not move immutable tags, replace release assets, or blindly overwrite later work. Public Pages deployment is separate from VM rollback; native build 51 is unchanged by either.
