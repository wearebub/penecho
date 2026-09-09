# Tenet Whiteboard iPad usability layer

This document records the student-facing iPad architecture and the September 2026 usability pass. It is the starting point for future TestFlight work on navigation, Pencil input, notebook storage, and document exchange.

## Product boundary

Tenet Whiteboard is a Capacitor iPad application. The web canvas remains the editable document and mixed-object model. Native Swift code supplies capabilities where iPadOS is materially better: authentication handoff, Keychain storage, managed configuration, PencilKit, document picking, PDF rendering, PDF creation, and the system share sheet.

The iPad does not host a Tenet Gateway. AI requests continue to route to the district-selected Gateway. This usability pass does not change authentication, managed student rules, Gateway routing, selection-AI payloads, or provider credentials.

## Student shell

- The upstream PenEcho wordmark is replaced with the Tenet symbol and Tenet name.
- The Tenet mark opens Pages & files.
- New, Pages, Open, and Export PDF are labeled header actions rather than unlabeled icons.
- Upstream sharing, cloud account, API/CLI settings, and Echoes entry points are hidden in Tenet mode.
- The coordinate readout is hidden.
- The top bar and notebook account for iPad safe areas.
- Tapping outside the canvas-title editor or pressing Return dismisses it before Pencil input resumes.

AGPL attribution for the PenEcho canvas foundation remains visible. Hiding upstream product controls does not remove the attribution or change the license boundary.

## Pages, subjects, and paper

The Pages & files surface remains local-first. Page snapshots are stored in IndexedDB and notebook metadata remains in local storage. Subjects, page cards, autosave, create, open, rename, duplicate, and delete behavior remain part of the notebook layer.

Students can explicitly select Blank or Grid paper. The selector drives the existing persisted canvas grid state rather than introducing a second rendering system.

Primary actions are:

- New page
- Open document
- Export PDF
- Add image
- Apple Pencil sketch

## Apple Pencil and canvas ink

Apple Pencil sketch opens a native PencilKit surface. Its purpose text now explains that Done places the sketch onto the current page. PencilKit keeps its native tools, palm rejection, pressure behavior, undo/redo, configured finger-drawing policy, and Pencil double-tap behavior.

The PencilKit result is currently inserted into the mixed-object canvas as a PNG image. It is therefore movable and resizable as an object, but its individual PencilKit strokes are not editable after insertion.

The previous blue-checkmark failure was not a PencilKit stroke failure. Native Done successfully rendered and returned the PNG, but the old web bridge fetched that data URL, constructed a `DataTransfer`, assigned a synthetic `FileList` to the hidden image input, and dispatched a synthetic change event. That browser-oriented handoff is unreliable in WKWebView and did not provide an imported-object result, so completion could close the native sheet without proving that anything reached the canvas. The iPad path now decodes the bounded PNG directly, calls `addImageFile()`, and reports success only when the canvas returns the created image record.

The main canvas continues to use web pointer input. It consumes browser coalesced pointer samples through one authoritative path so fast strokes retain intermediate points without duplicate processing or backtracking.

Long term, full-canvas native ink should use a PencilKit ink layer synchronized with the web object layer. Replacing the entire canvas with PencilKit is not appropriate because PencilKit does not model PDFs, images, text, AI graphs, HTML widgets, or Tenet selection objects.

## Object manipulation

Pen and touch now use coarse input targets for image and widget resize handles, delete controls, and pending AI-object actions. Mouse hit sizes remain unchanged. Imported document pages support finite, clamped placement offsets so multipage imports can be laid out vertically without changing legacy one-image imports.

`addImageFile(file, options?)` returns the imported image record on success and `null` on refusal or failure. Supported options are finite `offsetX` and `offsetY` values in canvas units.

## Native document import

`TenetNative.pickDocument()` opens the iPadOS document picker for one PDF or common image. Processing is local and returns rendered PNG pages to the canvas bridge.

Limits:

- 40 MiB maximum source file
- 24-page PDF maximum; larger documents are rejected rather than truncated
- Orientation-correct image downsampling
- 2,400 px and 6 megapixels maximum per page
- 5 MiB maximum per rendered PNG
- 18 MiB maximum combined rendered output

The web bridge decodes returned image data with a 24 MiB bound and places pages sequentially on the current canvas. No document content is uploaded by the native import path.

## Native PDF export

`TenetNative.exportPdf({ dataUrl, filename })` accepts the current rendered page as a strict PNG data URL, creates a one-page local PDF, and presents the iPadOS share sheet.

Limits:

- 16 MiB maximum decoded PNG
- 8,192 px maximum dimension
- 32 megapixels maximum
- 120-character sanitized filename
- 1,440-point maximum PDF page
- 24 MiB maximum generated PDF

Temporary export files are deleted after sharing or cancellation. No export content is uploaded by this path.

## Build and release procedure

1. Use `npm ci`; do not use `npm install` for routine setup because npm 11 rewrites peer annotations in the lockfile.
2. Run `npm run build:client` to regenerate `public/app.js`. Never edit that generated file directly.
3. Let the iOS workflow run Capacitor synchronization before Xcode compilation.
4. Compile and sign on hosted macOS using the existing App Store Connect credentials and provisioning secrets.
5. Upload a new build number to TestFlight and test on physical iPad hardware.

Physical-device checks should cover top safe-area spacing, fast main-canvas strokes, PencilKit Done placement, title-field dismissal, image deletion, graph resize targets, blank/grid switching, local notebook reopen, multipage PDF import, PDF export, and district Gateway routing.

## Intentionally unchanged

- Authentication and Keychain session handling
- Managed student-rule configuration
- District and Gateway resolution
- AI-selection crop boundaries
- Existing notebook storage format
- Existing Pencil double-tap behavior
- PenEcho canvas attribution and AGPL obligations
