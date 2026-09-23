# Tenet Whiteboard 1.14.0

## Scope and root cause

Teacher replay images were fixed-size and lacked a local magnification/pan model,
making handwriting difficult to inspect on iPad. This release adds view-only replay
zoom to the canonical client source and builds both the app and public viewer from
that source. The initial generated-file-only patch was corrected before release.

- Pinch, double-tap, zoom buttons, Fit and keyboard magnification from 100% to 600%.
- Drag to pan when magnified; bounded image position and 48px touch controls.
- Magnification persists across replay frames/seeks and resets for different work.
- Resize/orientation updates and pointer/observer cleanup on close.
- At Fit, one-finger swipes can scroll the surrounding report.
- Project AGENTS.md records standing approval for routine scoped tests and checks.

## Rejected alternatives and unchanged boundaries

Global WebView/browser zoom would enlarge the entire report and interfere with its
controls. Unsafe inline styling would weaken strict CSP. Instead, the replay image
uses SVG foreignObject geometry attributes, with no added raster buffers or CSP
exceptions. No recapture or replacement of saved checkpoints is needed.

No changes to saved notebooks/history, retention limits, image resolution, AI
requests, Gateway policy, authentication, server behavior, dependencies or native
code. Zoom improves inspection, not the resolution of existing recorded images.
The history-preservation fix in hosted 1.13.1 remains intact.

## Qualification

- Focused viewer suite: 114 passed, 0 failed, 0 skipped.
- Full npm check: 1,471 tests; 1,468 passed, 0 failed, 3 skipped.
- Both generated clients rebuilt from canonical source.
- New tests cover pinch focal anchoring, pan bounds, double tap, drag/long-press
  distinction, Fit scrolling, keyboard/trackpad, zoom limits, frame persistence,
  resize and cleanup, and strict-CSP rendering.
- Real local app browser: image rendered at 195%; drag changed bounded geometry,
  seeking retained 195%, and Fit restored 100%.
- One earlier startup MutationObserver console error was observed but did not
  recur on reload; it was not attributed to this zoom change.
- Physical iPad acceptance is still required; browser/unit checks do not establish
  WKWebView touch behavior on a physical device.

## Release boundaries

Hosted tag: tenet-web-v1.14.0.
Native companion remains tenet-ipad-v1.11.0-build.51, not a new TestFlight upload.
Baseline: tenet-web-v1.13.1, commit 22cc1f82fbd7bf16bac24bf54d13e3ead223220d.

Expected runtime delta, exactly four files:
- public/app.js
- public/tenet-history-viewer.js
- public/tenet-process.css
- src/client/app/tenet-process-ui.js

Publication requires green hosted release CI, an immutable runtime archive,
manifest/hash qualification, guarded host backup/install with unchanged policy and
service identity, and public Teacher Preview source/hash verification. Deployment
evidence and rollback location will be recorded after qualification.

## Published release evidence

Hosted Whiteboard 1.14.0 is deployed. Source commit:
`5ffc2f542d2aaa35f16825d6389b04b2290c7bad`.

All four workflows completed successfully:
- Push CI: https://github.com/wearebub/penecho/actions/runs/35915967791
- Immutable web release: https://github.com/wearebub/penecho/actions/runs/35915967540
- Public Teacher Preview: https://github.com/wearebub/penecho/actions/runs/35915971628
- iOS CI / unsigned macOS compile: https://github.com/wearebub/penecho/actions/runs/35915968255

Release: https://github.com/wearebub/penecho/releases/tag/tenet-web-v1.14.0
Public viewer: https://wearebub.github.io/penecho/

The public viewer source receipt and all three published files matched the
immutable release. The published page loaded in the browser. Further
post-publication click automation encountered browser/CDP timeouts; those
attempts are not evidence of live touch or physical-iPad acceptance. Local browser
zoom/pan/seek/Fit and the regression results above remain the completed
interaction evidence.

Native companion remains 1.11.0 (51); there was no new signed TestFlight upload.
Save current work before reopening the iPad app to load the hosted update.

## Private operational evidence

Deployment completed with a guarded rollback backup. Internal infrastructure
receipts and rollback commands remain private on the deployment host and are not
included in this public repository. Hosted-client rollback and public Teacher
Preview rollback are separate operations; neither should delete saved notebooks
or alter the native binary. Use the private deployment record and the prior
qualified release if rollback is required.
