# Tenet Whiteboard 1.3.0 release record

Released September 9, 2026 (America/Chicago).

## Exact identities

- Release source: `e898540f4f735b075e5fd6abbcd1239cfe581361`.
- Feature commit: `2a730912c43c1a42852336133fee400519987b38`.
- iPad: `1.3.0 (25)`, bundle `ai.truemade.tenet.whiteboard`.
- Native immutable tag: `tenet-ipad-v1.3.0-build.25`.
- Hosted immutable tag: `tenet-web-v1.3.0`, paired with native build 25.
- Desktop package identity intentionally remains `1.2.0`; no desktop release.

[Native release](https://github.com/wearebub/penecho/releases/tag/tenet-ipad-v1.3.0-build.25)

[Hosted release](https://github.com/wearebub/penecho/releases/tag/tenet-web-v1.3.0)

[Native qualification and upload](https://github.com/wearebub/penecho/actions/runs/34430510639)

[Hosted qualification and publication](https://github.com/wearebub/penecho/actions/runs/34431055443)

## Delivered scope and reasoning

Toolbar and notebook overlays now participate in native hit-test exclusions,
including layout, resize and viewport-scroll updates. The root problem was a
native drawing surface accepting Pencil input behind web controls, not a need
to simulate button clicks or disable Pencil drawing everywhere.

Pencil-only mode uses one-finger shared navigation; touch-drawing mode uses two.
Native internal offsets and zoom are pinned to the shared JavaScript viewport.
Moving saved strokes to compensate was rejected because it would corrupt the
relationship between handwriting, placed objects, undo history and AI baselines.
See `tenet-native-navigation-1.3.0.md` for the contract and device acceptance steps.

The release also includes larger drawing options, line-width presets within the
existing canvas range, finger/regular-stylus compatibility with managed-policy
enforcement, local standard-shape insertion, and first/four-quadrant graph
templates. Templates are resizable image objects, not editable vector diagrams
or function plotters; inserting them does not call AI. Recent work is removed
from the Tenet UI while its title/save ownership remains intact. Pages & files
is the student library, and header file actions no longer overlap.

Authentication, Gateway routing, student rules, notebook schema and AI context
selection were intentionally unchanged. Existing branding, paper choices,
document tools, object controls and notebook persistence are retained.

## Qualification

- Local `npm run check`: 968 tests, 965 passed, zero failed, 3 existing skips.
- Required Node 22 and Node 24 CI passed in both publishing workflows.
- Hosted macOS simulator compilation, signed archive and IPA verification passed.
- TestFlight upload succeeded. Apple's email at `2026-09-10T02:51:26Z` confirmed
  "Tenet Whiteboard 1.3.0 (25) for iOS is now available to test."
- Browser smoke tests exercised line width, persisted input preference, graph
  and shape insertion, save/reload and reopening a notebook page with three
  images. File actions were separate, and Recent work was absent.
- Fresh launch and drawing-options checks had no console errors. An isolated
  MutationObserver error occurred during an earlier reload; it did not recur on
  fresh launch and was not attributed to a source change.
- Local browser tests used a loopback-only nonfunctional AI endpoint. They did
  not send student content to an AI provider or establish live AI quality.

Physical iPad qualification remains separate: Pencil toolbar taps, fast ink,
finger navigation/alignment, lasso, pinch, undo/redo, rotation, managed touch
denial and Files/share-sheet behavior still require real-device testing.

Build 23 was canceled while its upload step was active after the new navigation
report. It has no completed immutable release record. Build 25 is the confirmed
replacement; do not identify build 23 as this release.

## Artifact hashes

| Artifact | SHA-256 |
| --- | --- |
| Signed IPA | `1f6bb71ac90c773e50a506176ad8d3594c0c0d6439f8ef14a85a8587317869ea` |
| Native source ZIP | `1a0a4d5c9acdc49601894b537c99a87aa1f2568f92fd5eb0f5981a273576fcb8` |
| Native release manifest | `f1616c14a20a7ca5286b658d3a8d9fbc5bfe73ae9bae4c9c17f1549422df6f7c` |
| Hosted client TAR | `1d824580c436dbf8aae08f0030c8f028186ee798d289142dabc562c1dc50072f` |
| Hosted release manifest | `45429b916cc3c110124fe01f07c417e5c405ba2fc4e1e5113c9df748b9645ff1` |
| Served `public/app.js` | `1f6b3f0af14a11408d74892e11c6759c4341f6ed501450252ed6cfb0de0f2e55` |

Published release digests were compared with downloaded artifacts before the
hosted deployment. The deployment checked the manifest's source, version,
paired native release, allowlisted paths and every extracted file hash.

## Hosted deployment receipt

- Project: `tenet-connect-demo`.
- VM: `tenet-gateway-demo`, zone `us-central1-a`.
- Application root: `/opt/tenet-demo/penecho`.
- Installed at: `2026-09-10T02:53:23.526Z`.
- Backup and receipt directory:
  `/opt/tenet-demo/backups/whiteboard-1.3.0-e898540`.
- Receipt: `deployment-receipt.json` in that directory.
- Previous receipt:
  `/opt/tenet-demo/backups/whiteboard-20260909-ae100f1/deployment-receipt.json`.

All 23 client/source paths matched their prior receipt before replacement and
were backed up. Only changed files were atomically replaced, with `app.js` last.
No runtime configuration, secrets, student work, dependency installation or
service restart was included. The guarded deployment helper is retained beside
the receipt and refuses unexpected files, symlinks and concurrent changes.

Both loopback instances, ports 3888 and 3889, served all five public assets with
HTTP 200, `Cache-Control: no-store` and hashes matching the published manifest.
Unauthenticated requests to both `district.connect.truemadeai.com` and
`spanish.connect.truemadeai.com` returned HTTP 302 through the existing sign-in
boundary. This is an access-boundary check, not a new authenticated AI canary.

Service identities before and after deployment were unchanged:

- `penecho-demo.service`: active, PID 54543.
- `tenet-mobile-auth.service`: active, PID 60559.
- `caddy.service`: active, PID 54100.

## Rollback and next release

Follow `tenet-whiteboard-releases.md`. Never overwrite an immutable tag, source
archive or IPA. Native rollback uses preserved source to produce a new,
higher-numbered qualified build; this record is not an instruction to deploy it.

The prior hosted release is `tenet-web-v1.2.1`, source
`ae100f11c1eb45a6fa8dc31a73b57ceafe8df83b`. The backup above retains exact prior
bytes and the receipt maps both old and installed hashes for every path. A
future authorized restore must compare current hashes before replacing only
those paths, leave notebook/auth/Gateway data untouched, and repeat served-hash
and sign-in-boundary checks. No rollback was executed for this release.

This documentation-only record follows the release-source commit. It does not
change the source identity or publish another application build.
