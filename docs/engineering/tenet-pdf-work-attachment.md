# Tenet PDF with portable work

## Contract

Saved-page PDF exports embed the complete v1 `.tenet` package, unchanged, as
`work.tenet` in a standard PDF EmbeddedFiles name tree. The visible report and
package come from one saved snapshot. The iPad notebook-menu export saves the
current page locally first; Teacher view exports the selected saved version,
not unsaved canvas edits. Both offer a separate `.tenet` share action.

The teacher viewer accepts the original Tenet-produced PDF or `.tenet` file.
It follows a bounded cross-reference table and the attachment name tree, then
passes the extracted bytes through the existing gzip, SHA-256, asset, history,
and provenance validation. It does not render PDF content, execute PDF actions,
scan image streams for work data, upload files, or grant teacher authority.

Legacy capture archives and synthetic examples without a complete saved-page
package remain explicitly labeled report-only PDFs. A saved page lacking old
history still includes its genuine saved data, with history unavailable.

## Limits and privacy

- Combined PDF: 24 MiB; separate `.tenet`: 64 MiB. Existing decompression,
  per-asset, event, image and report page limits remain unchanged.
- Oversized embedded exports fail with the separate `.tenet` option. No history
  is silently dropped to fit a PDF. Known recording gaps remain labeled.
- Anyone holding the PDF also holds the attached student work, recorded AI
  questions, responses and retained client inputs. Both the dialog and visible
  PDF disclose that fact. This is not encrypted or server-attested evidence.
- The original downloaded file is required. Printing, sanitizing, or converting
  a PDF may remove/rewrite attachments. Ordinary PDFs and unsupported rewrites
  fail explicitly rather than fabricate history or replace the current view.
- District LMS upload/download preservation remains unqualified until tested
  with an actual original-file round trip. No LMS submission receipt is implied.

## Engineering decisions

Root cause: the old report and native canvas PDF paths exported only rendered
images, while playback and complete retained input data lived in a separate
package. Updating only the report would leave the notebook menu inconsistent.

Rejected: hiding arbitrary JSON in metadata, appending a nonstandard payload,
creating a GIF, or rendering an untrusted imported PDF to discover its data.
A real attachment preserves the existing portable file and standard PDF use.
The importer intentionally supports our own bounded single-revision envelope,
not a general-purpose PDF engine or rewritten documents.

Intentionally unchanged: `.tenet` v1 encoding, capture/timing semantics, native
file-sharing limits, Gateway prompts and district rules, authentication,
assignment permissions, and LMS integrations. No native plugin change is needed.
