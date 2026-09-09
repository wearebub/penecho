# Main-canvas PencilKit integration

## Purpose and boundaries

The previous native drawing screen was an isolated sketch importer, not the
notebook's input surface. Main-canvas PencilKit now has a bounded adapter to the
same document, viewport, history, export, and AI capture paths as Web ink.

The iPad initially uses Web. The toolbar's **Ink: Web / Ink: PencilKit** switch
changes input engines without clearing work. **Compare ink** runs repeatable
local trials and collects subjective ratings. See `tenet-ink-comparison.md`.

Two independent notebooks and destructive bitmap conversion were rejected:
they would lose editable strokes and invalidate a same-document comparison.
Authentication, Gateway routing, student rules, AI prompts, and provider request
formats are intentionally unchanged. Only rendered page pixels enter the existing
AI capture pipeline; native archives and comparison results do not.

## Load-bearing integration points

- `core.js` opens the shared canvas closure; `ui-bootstrap.js` closes it.
  Modules needing canvas functions must be concatenated before `ui-bootstrap.js`.
  This also fixes the sketch checkmark and PDF importer/exporter reaching outside
  their JavaScript scope. The old synthetic file-input importer is removed.
- `tenet-native-ink.js` owns session IDs, snapshot decoding, synchronization,
  preview rendering, global history integration, and the small `window.TenetInk`
  comparison API. New page/session callbacks are rejected by session and revision.
- `TenetInkSurface.swift` owns PKCanvasView, PKToolPicker, managed input policy,
  native navigation gestures, bounded snapshots, and stroke-change bounds.
- Native ink is stored in the existing snapshot manifest extension
  `tenetNativeInk`, version 1: PKDrawing base64, transparent preview PNG,
  world-space preview bounds, and stroke count. Do not replace editable originals
  with the preview. Native archives are capped at 16 MiB; PNG previews at 12 MiB,
  4096 pixels per dimension and 16 million pixels. Native history has a bounded
  serialized budget in addition to the ordinary entry-count limit.
- Each page has one JS viewport authority. CSS viewport coordinates are converted
  to UIKit coordinates once. Pan and zoom apply to native ink, Web ink, images,
  text, and graphs. Native navigation centers are viewport-global, not relative
  to the canvas; subtract the canvas frame origin in JS.
- Native overlay hit-test exclusions keep the AI orb, page controls, comparison
  stop button, and web panels usable. Hand mode and modal dialogs hide native ink
  and display its cached preview while web object manipulation owns input.
- Native picker changes survive ordinary viewport synchronization. Explicit web
  tool activation increments `toolRequestId` so clicking Pen still works after
  selecting a different native tool in the palette.
- Save, export, page transitions, and AI capture await a native flush. An active
  stroke or failed snapshot refuses the operation rather than claiming a save.
  The existing notebook autosave owns durable device storage. Unload callbacks
  are not proof of durable persistence.
- Native changed stroke bounds accumulate through the existing dirty-region and
  revision tracking. Old-versus-new emphasis therefore stays in the existing AI
  image pipeline. Bounds are conservative stroke bounds, not exact pixel diffs.

## Editing limitations to preserve honestly

Web raster ink and native strokes remain separate editable layers. The selected
engine edits its own ink. Native lasso/eraser operate on native strokes; Web lasso
operates on Web ink. The native lasso does not create a Web AI-selection crop.
Use the ordinary tutor capture for native ink. Hand mode edits images and graphs.
Opening an old Web page does not retroactively turn raster ink into PKStrokes.

The separate Apple Pencil sketch action remains an optional image importer.
Its checkmark adds a picture; the main-canvas engine switch instead keeps strokes
editable. Neither native gesture quality nor actual Pencil-to-pixel latency can
be established on Windows or with a JavaScript native-bridge mock.

## Update and release procedure

1. Use `npm ci`, not an unqualified `npm install`, in both root and mobile package.
2. Build `public/app.js` with `npm run build:client`; never hand-edit the bundle.
3. Run native-ink adapter, mobile-package, branding, and selection checks. Exercise
   the comparison UI separately; fake native API checks are not PencilKit tests.
4. Commit source, tests, docs, and the generated bundle on `codex/tenet-ipad`.
5. Compile on hosted macOS using `.github/workflows/ios-release.yml`. Signed
   upload requires its explicit `build_signed_ipa` and `upload_testflight` inputs.
6. Update the configured Whiteboard host's web assets too: this Capacitor build
   loads that governed host after native sign-in. Preserve authentication,
   provider config, notebook storage, service state, and server-side Gateway keys.
   Back up replaced assets. A successful IPA upload alone does not update web UI.
7. On the physical iPad, verify native ink over graphs, two-finger navigation,
   tool switching, modal controls, save/reopen, mixed undo, background/foreground,
   PDF export, and unchanged tutor behavior. Compare both engine orders on the
   same task and zoom before selecting a default.

## Validation status

Local adapter/package/branding checks: 20 passed. Selection checks: 14 passed.
The assembled client parses and the ordinary Web interface opens without console
errors in the local browser. Native compilation, signed upload, and on-device
input qualification must be recorded separately from these source checks.
