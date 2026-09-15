# Portable saved-work submissions

Version: 1.11.0. Publication evidence belongs in the immutable release receipts; this feature is not an LMS integration.

## Student and teacher workflow

1. Save the whiteboard normally. In Pages & files, choose Share work on that saved page.
2. Export the compact `.tenet` work file. This is the saved version, not an implicit save of current edits.
3. Optionally prepare a PDF work report with the saved preview and recorded AI questions, responses and outcomes.
4. Attach the work file and optional PDF through a school-approved LMS or storage destination. Exporting is not confirmation of submission.
5. The teacher downloads the work file and chooses Open shared work in the Tenet browser viewer. Playback and AI inspection run locally in that browser session; no iPad is needed.

The file includes student work, retained client request inputs and images, and AI responses. It is not encrypted by the export format, and an exported copy cannot be remotely revoked. Follow school retention/access requirements. There is no automatic upload, public share link, or new analytics destination.

## Why not a GIF?

GIF/video flattens the useful evidence into pictures. It cannot preserve clickable questions, submitted crops, original request JSON or recorded outcomes. Repeating a full image for every playback frame also wastes space. The portable file instead deduplicates identical Blob assets and gzip-compresses its versioned manifest and asset table. It preserves retained image bytes rather than silently degrading them. Size depends on the actual images and history; no universal compression ratio is promised.

The initial format uses a bounded binary envelope, SHA-256 integrity checks and a compressed JSON payload. The file ceiling is 64 MiB, expanded JSON 96 MiB, unique decoded assets 64 MiB, and an individual asset 16 MiB. Existing history limits remain 5,000 events, two attachments per event and 12 KiB of event details. Oversized exports/imports fail explicitly rather than deleting evidence to fit. JSON/base64 overhead can make an export hit the expanded limit before the asset limit.

## PDF report

The optional PDF is a readable companion, not the history container. It includes a saved-page view when one was retained, recorded questions and text replies grouped by unique local request IDs, outcomes, and coverage limitations. Missing or ambiguous links are not guessed. Request images and full client JSON remain in the work file to avoid duplicating large attachments in the PDF.

The report uses bounded raster pages to preserve the characters the device can render without downloading fonts or adding a PDF library. Text in the PDF is not searchable/selectable; recorded text remains available in the browser viewer. It is limited to 64 pages, 24 MiB and 2 MiB of source report text. If exceeded, share the complete work file rather than a silently shortened report. A legacy saved thumbnail is labeled as a preview, not a full-resolution reconstructed page.

## Native sharing

The iPad plugin adds `exportFile({base64, filename})`, restricted to bounded `.tenet` and `.pdf` files with safe filenames. It shares a protected temporary file using the existing native presentation lock and removes that temporary directory on completion or error. Existing single-page PDF export is unchanged. This method requires an updated signed native app; a hosted JavaScript update does not add a Swift method to an older binary. Old-native sharing must either use supported Web Share or explain the update requirement, not silently fail a WKWebView download.

## Deliberate boundaries

The viewer never loads imported objects as executable widgets or replaces the student's active canvas. It checks package structure, bounds, references and hashes before review. A checksum detects inconsistent bytes; it does not establish student identity, authorship, school receipt or absence of outside help. The package is for read-only review, not an implemented notebook restore/import workflow.

Client request history observes the prepared Whiteboard request, not a complete server/Gateway/provider prompt or independent policy receipt. No assignment binding, school account authorization, remote teacher access, LMS API, roster synchronization or district rule changes are introduced.

The next LMS slice can upload this versioned package as an immutable submission revision and attach a PDF plus an access-controlled review link. That service must independently verify student/assignment membership and teacher access. It is not implemented here.

## Engineering decisions and qualification

Root cause: ordinary saves own their history but another device cannot read the iPad's local IndexedDB. A standalone viewer for older manual archives is not an export path for ordinary saved whiteboards.

Rejected: GIF/video as the authoritative record, opaque PDF metadata as the sole delivery mechanism, lossy recompression of evidence images, automatic notebook uploads, and weakening import limits to make large files appear to work.

Intentionally unchanged: saved-page transactions, history retention budgets, both ink engines, authentication, district Gateway routing, tutoring policy, the legacy archive reader and existing PDF export.

Before release, qualify local save/export/open round trips with both ink engines, AI images and late replies, old/no-history pages, deduplication, corrupt digests/references, gzip expansion limits, unsupported versions, account switches, interrupted sharing, strict CSP and native modal hit testing. Exercise the PDF and compressed file in a fresh browser context, then run canonical CI, macOS compilation and the signed iPad release. No test or delivery claim follows from generating client bundles.

Local qualification on 2026-09-15 covered 94 codec/history tests, 87 viewer tests, 37 native-boundary tests and 17 sharing/report tests (overlapping suites; do not sum these counts). A real saved page exported through the browser to a 116,930-byte work file and decoded independently in a fresh JavaScript context: 306,179 expanded bytes, five unique assets, eight events, and exact retained client JSON/image bytes. The optional external-artifact regression uses TENET_SUBMISSION_ARTIFACT; CI without that local file intentionally skips only that additional check.

Browser checks exercised actual saved-page export, visible confirmation, fresh saved-page PDF preparation, and report download. The two-page PDF was parsed and visually rendered with Poppler. The browser automation surface did not support setting the native file chooser, so file-input handling is covered by the viewer tests and the actual download was independently decoded, not claimed as an automated end-to-end browser picker test. Physical iPad share-sheet, file-picker and lifecycle acceptance remain separate from source tests and hosted compilation.
