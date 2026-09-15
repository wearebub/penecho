# Tenet Whiteboard 1.12.0: PDF with embedded work

## Scope

- Saved-page PDFs embed the complete existing `.tenet` v1 package by default.
- iPad notebook PDF export saves the page locally first and uses the same saved
  snapshot for the visible report and embedded file. No image-only fallback.
- Teacher view opens an original Tenet PDF or a separate `.tenet` file locally.
- The PDF report dialog also offers an independent `.tenet` share action.
- Legacy captures/synthetic examples without a saved-page package are clearly
  labeled report-only. Missing history is not reconstructed.

Root cause: PDF exports were raster-only and disconnected from the portable
work package, including a separate native notebook export path.

Rejected: arbitrary metadata, appended non-PDF payloads, GIF/video exports,
re-reading different saved versions for the report and attachment, and silently
dropping history to meet sharing limits. Standard EmbeddedFiles attachment
objects retain the existing lossless work format.

Unchanged: native iPad 1.11.0 (51), Gateway/provider prompts, district rules,
authentication, capture/timing semantics, server code, dependencies, `.tenet` v1
encoding, and LMS integrations. PDF limit remains 24 MiB; `.tenet` remains 64 MiB.

## Qualification before publication

- `npm.cmd run build:client`: passed; generated bundles from 25 source modules.
- `npm.cmd run check` with the actual exported-work fixture: 1,445 tests,
  1,442 passed, zero failed, three existing skips.
- 20 new PDF regressions cover exact work round trips, single-snapshot ownership,
  nonrecursive re-export, invalid PDFs, damaged attachment/xref data, limits,
  sign-out/cancellation, teacher routing and the iPad export handler.
- Real browser: exported a two-page PDF and standalone work from the saved
  eight-event synthetic regression page; no provider was configured or called.
- Independent strict pypdf reader found `work.tenet` as a standard attachment;
  its bytes exactly matched the separate browser download.
- Actual codec opened the browser PDF with eight events and the original
  91,042-byte recorded AI input JSON. The first PDF page was rendered with
  Poppler and visually inspected.
- PDF: 403,232 bytes; SHA-256
  `f73870c503b5e6dfc4d1020198ea94a28c8f36a3e486ebd0460aef634c98a134`.
- Attached/standalone work: 116,929 bytes; SHA-256
  `00061f3d6b1db646d6e056ba0aa291f7addc77d8e49394540bebdd69256dd9bf`.

## Publication and rollback

Planned immutable hosted-client tag: `tenet-web-v1.12.0`, paired with existing
`tenet-ipad-v1.11.0-build.51`. Publish the public teacher viewer and both demo
hostnames only from this qualified source. Deployment and viewer receipt JSON
files accompany this record after successful publication.

The runtime manifest must retain exactly the previous 40-file scope. Only seven
client paths may differ: app bundle, teacher bundle/HTML, and the usability,
teacher UI, portable codec and report/share source modules. Preserve service
PIDs, installed dependency lock and demo policy. No restart is required.

Rollback baseline is immutable `tenet-web-v1.11.1`, source
`d384a649ead548acc86e7ec3421502fa2e330ff9`. The qualified deployment creates an
owned backup plus rollback helper/receipt before replacing any live file.

## Remaining acceptance boundaries

Physical iPad touch/share-sheet acceptance remains to be checked on-device.
No new TestFlight binary is required for this hosted-client change. A published
bundle does not prove the currently open app has fetched it.

LMS original-file upload/download preservation has not been qualified. Printing,
sanitizing, or converting a PDF may remove/rewrite attachments; the viewer
requires the original Tenet export. Anyone holding the PDF can read its attached
student work and recorded AI inputs. Export and visible PDF disclose this.
Local observations and checksums are not proof of identity or authorship.
