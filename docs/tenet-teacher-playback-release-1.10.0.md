# Tenet Whiteboard 1.10.0 qualification

Date: 2026-09-15. Hosted-client release paired with the existing native
`tenet-ipad-v1.8.0-build.46`. This is not a new TestFlight binary.

## Root causes and implementation

The viewer cleared and fetched its image on every raw event, even when the page
checkpoint had not changed. Fixed one-second event stepping also exposed internal
request/response/finish records as separate teacher-facing steps. The new viewer
keeps a bounded decoded checkpoint cache, preloads the next checkpoint, retains
the displayed frame until a replacement is ready, and offers 0.5x/1x/2x/4x/8x
recorded-time pacing with an explicit option to skip long pauses.

The timeline groups related AI records by their recorded request identity. One
interaction exposes the observed question, replies, outcome and available client
inputs. Only explicitly linked edits are attributed to that interaction; proximity
alone is not a link. The graph counts observed canvas edits/native revisions and
marks AI requests with purple stars. Raw records remain available underneath.

Earlier request history retained metadata but not the actual serialized client
body or submitted crop. New bounded `ai.input` records can retain both, and record
quick-help, specific-question, voice-path or automatic origin. The inspector is
lazy, uses text rather than executable HTML, and keeps input images separate from
page playback. Missing, oversized, redacted and legacy inputs remain explicit.
See `docs/tenet-ai-request-history.md` for the exact capture contract.

## Alternatives rejected and deliberately unchanged

- Did not delete raw events to simplify the interface: replay and diagnostic
  history still need them.
- Did not simulate intermediate pen strokes or turn checkpoint playback into a
  screen recording. Accepted native revisions may contain multiple edits.
- Did not infer a complete provider prompt from client metadata. Captured JSON is
  the client-to-Whiteboard request, not a Gateway receipt or downstream policy.
- Did not block tutoring on local history hashing, retain raw microphone audio,
  send history to another service, or weaken attachment/memory limits.
- District routing, identity, AI rules, provider behavior, native binary code,
  LMS integration and submission/export architecture are unchanged.
- No dependency changes. The lockfile changes only its two root version fields.

## Qualification

Canonical gate: `npm.cmd run check` passed with 1,343 tests, 1,340 passes, zero
failures and three existing skips. Log: `%TEMP%/tenet-1.10.0-final-check.log`.
Do not interpret a local gate as publication or installed-device proof.

Focused gates (overlapping suites, not additive totals):

- UI: 59 passed, including grouped request identity, linked late edits, bounded
  cache/decode, pacing, graph seeking, input inspection, ownership/cleanup, CSP,
  and the 900px portrait breakpoint.
- History: 77 passed across document history, real request orchestration with
  stubbed transport, persistence integration and legacy journal/capture suites.
- Independent native/archive/CSP audit: 52 passed. These are controlled/source
  contracts, not physical-device input or browser-codec certification.

The first canonical run found one stale authentication source-contract assertion:
it expected headers inline in `fetch`, while the captured request is now built
once and passed to `fetch`. The assertion now checks the same-origin request
object, `aiRequestHeaders`, the exact fetch argument and captured body together.
The runtime authentication path was not weakened to satisfy the test.

## Actual browser checks

Used the real server on loopback port 4179 under its normal strict CSP, with only
synthetic local test work and no configured AI provider.

1. The synthetic example completed at 8x. Its purple star opened one combined
   interaction containing the scripted question and reply; unavailable legacy
   input metadata was not invented.
2. Inserted a rectangle, submitted Visible-page Quick help, named and saved the
   whiteboard through ordinary controls, and reloaded the complete application.
3. Teacher view selected the actual saved page without replacing the blank
   scratch canvas. Eight stored records appeared as six work moments with one
   AI interaction. The request was correctly labeled Quick help, action `hint`,
   with a failed outcome because the local provider was intentionally absent.
4. Opened the recorded JSON and exact submitted rectangle image from that save.
   The atlas was replaced only in the text preview by a labeled placeholder; the
   recorded body was retained. The AI image was not treated as a page checkpoint.
5. Checked portrait width 768px. The first layout was too narrow; the existing
   stacked layout and capped saved-page list now apply through 900px. The actual
   portrait browser view showed the corrected full-width stacked layout.

Successful provider replies, speech-origin paths, malformed assets and race/limit
cases were exercised in controlled regressions, not paid live AI or physical iPad
testing. No claim of microphone, Pencil latency or installed-device acceptance is
made by this qualification.

## Publication and rollback boundaries

The intended immutable release is `tenet-web-v1.10.0`. Its archive and GitHub CI
are separate from installation. The deployment must compare every runtime hash
against the installed 1.9.0 receipt and permit only the six changed client files.
Server/dependency bytes, service PIDs, district policy and authentication redirects
must remain unchanged. No service restart is needed for this client-only delta.

Baseline: `feb04e7a86d71b6e2f5bd176eb3e7907454d3e5b`, installed receipt
`/opt/tenet-demo/backups/whiteboard-1.9.0-feb04e7/deployment-receipt.json`.

Exact baseline-source audit found that 1.9.0 can load and resave the new JSON/image
attachments through its generic history schema, subject to existing retention
and storage-failure degradation. However, its viewer treats any image attachment
as a page checkpoint, including new AI input crops. Thus it is data-compatible,
not fully Teacher-view-semantics-compatible. Prefer a forward fix. Runtime backups
are not student-data backups, and older 1.8.1 overwrite still drops work history.
