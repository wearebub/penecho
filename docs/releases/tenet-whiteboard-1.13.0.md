# Tenet Whiteboard hosted 1.13.0

## Scope

Full-screen Teacher Viewer for the existing iPad application and the public,
local-file Teacher Preview. Paired native release remains
`tenet-ipad-v1.11.0-build.51`; this is not a new TestFlight binary.

- Full viewport with safe-area padding and an independently scrolling report.
- Saved work and files collapse after selection and remain available from the
  header. Narrow screens show the library or report rather than squeezing both.
- The activity graph uses clock timestamps and relative elapsed-time ticks.
  Missing or reversed device timestamps retain recorded order with an explicit
  limitation, never an invented time scale.
- Removed the redundant bottom Work timeline list. Graph seeking, playback,
  slider, AI request inspection and selected-observation details remain.
- Added 16x and 32x playback, retaining the 60 ms minimum display interval.
- Shows retained event JSON plus unique attachment sizes before compression.
  Missing or inconsistent attachment sizes are labeled incomplete. Saved canvas,
  file/database overhead and browser memory are excluded from this readout.

## Engineering decisions

Root cause: the viewer inherited generic narrow-dialog sizing, kept a permanent
library column beside the report, and repeated the same history in a bottom
event list. Graph bins were labeled by ordinal rather than recorded time.

Rejected: merely widening the modal, hiding timestamps/limitations, or discarding
history records to simplify the interface. A full-screen workspace with
progressive disclosure preserves evidence and gives reporting the space.

Intentionally unchanged: recording and retention, saved notebooks, .tenet/PDF
formats, Gateway policy, AI requests, authentication, native PencilKit/voice,
LMS integration and service processes. This is a four-path client-only runtime
delta. The test fixtures now model the real library visibility/focus lifecycle;
existing native modal fencing assertions remain intact.

## Local qualification

- `npm.cmd run check -- --test-concurrency=1`, with the existing original .tenet
  regression artifact: 1,454 tests, 1,451 passed, zero failed, three skipped.
- Focused viewer/native/history/submission integration: 142 tests, 141 passed,
  zero failed, one real-file test skipped in that focused command only.
- Browser under strict CSP with host application styles: full-screen at
  1280x960 and 768x1024; narrow 375x812 library/report switching; no horizontal
  document overflow or browser console warnings/errors observed.
- Original .tenet and embedded Tenet PDF imports render local saved history.
  Clock and elapsed ticks, AI input inspector and 16x/32x controls exercised.
- No physical-iPad acceptance performed here. Browser viewport testing and
  native integration fixtures do not replace device confirmation.

## Publication and rollback

Publish an immutable `tenet-web-v1.13.0` release after hosted Node 22/24 CI.
Deploy the exact manifest-qualified four client paths over installed 1.12.0,
preserving service PIDs, policy and dependency-lock hashes. Public Teacher
Preview must match the same source commit and manifest assets.

Expected runtime changes: `public/app.js`, `public/tenet-history-viewer.js`,
`public/tenet-process.css`, `src/client/app/tenet-process-ui.js`.

Baseline source: `6729802e81ae55d296d54d7d0ced0ee72d9b8357`.
Baseline receipt:
`/opt/tenet-demo/backups/whiteboard-1.12.0-6729802/deployment-receipt.json`.

## Published result

Source: `607673d7b981a3ad9fec9f22bc201b6a057e1c40`.
Immutable release: https://github.com/wearebub/penecho/releases/tag/tenet-web-v1.13.0

- Web release, including Node 22/24: https://github.com/wearebub/penecho/actions/runs/35053847530
- Public Teacher Preview: https://github.com/wearebub/penecho/actions/runs/35053849009
- Branch CI: https://github.com/wearebub/penecho/actions/runs/35053833581
- Unsigned iPad compile: https://github.com/wearebub/penecho/actions/runs/35053833703

All four workflows succeeded. No signed IPA or new TestFlight build was needed
or published. The existing native 1.11.0 (51) uses this hosted client update.

Installed on both district and Spanish demo hosts. All served manifest assets
matched their hashes with no-store caching. Both unauthenticated host roots
still returned 302. Service PIDs, policy and dependency lock were unchanged.
Public https://wearebub.github.io/penecho/ matched the source SHA and all three
published file hashes; its live sample rendered with the new full-screen UI,
clock axis and speed options, without console warnings/errors.

Sanitized evidence: `tenet-whiteboard-1.13.0-deployment.json` beside this note.
No notebook contents, credentials or policy contents are in that receipt.

Rollback, guarded against later unrecognized changes:

```sh
sudo node /opt/tenet-demo/backups/whiteboard-1.13.0-607673d/deploy-runtime.mjs rollback
```

Rollback restores the qualified installed 1.12.0 client files without restarting
services. The immutable 1.12.0 release remains available for public preview
republication as a separate operator action. Physical-device uptake remains
for the iPad user to confirm after fully closing and reopening the application.
