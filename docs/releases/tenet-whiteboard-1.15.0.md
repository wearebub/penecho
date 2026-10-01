# Tenet Whiteboard 1.15.0: Research and informative writing

## Root cause and scope

The canvas had drawing, images, text, arrows, and local notebooks, but no coherent
ELA research workflow. Amy Achs's informative-writing example needs students to
keep evidence, their own thinking, and source references distinct, then organize
them into subtopics before drafting alongside the board.

- Tools > Research opens a local research and writing workspace.
- Yellow evidence notes, blue student-thinking notes, green source notes, and
  labeled organizer frames. Titles, text, citation details, and safe website URLs
  remain editable; duplicate and delete use the existing canvas/history system.
- Research, informative-writing, cause/effect, and compare/contrast organizers
  insert without erasing existing work. Existing Hand, resize, and arrow tools
  support spatial grouping and connections. Arrows are not attached connectors,
  and a frame does not automatically move its contents as a group.
- Drag selected text, links, or supported image files onto the board. Quotes and
  links open for source review before insertion; remote images are not fetched.
- Dictate into a research note on-device, review, then add it. This is not Talk
  to Tenet: no AI request or automatic submission is made and no audio is saved.
  Keyboard dictation remains the fallback. This does not add audio recordings.
- Export a saved note/organizer or the board as PNG for a writing document.
  Browser uses a local download; iPad uses bounded native PNG file sharing.
  PDF/.tenet remains the route for work history. PNG is a flattened image only.
- Responsive layout supports narrow multitasking views. Existing iPad build
  configuration supports all orientations and does not require full screen;
  real iPad multitasking/device gestures still require acceptance testing.
- Teacher-provided PDFs can already be opened and annotated. Built-in templates
  need no network or AI. Live sharing, peer sessions, and LMS integration are not
  included in this release.

## Rejected alternatives and preserved boundaries

Rejected a separate database, a second notebook format, arbitrary HTML cards,
automatic fetching of pasted URLs, and a cloud collaboration service. Research
cards use existing local image objects plus a bounded version-1 `tenetResearch`
metadata field. Their PNG artwork remains readable by older clients, while the
new client retains semantic text/provenance through local saves and undo/redo.
Older clients can discard that optional metadata if they resave the page: export
a current PDF/.tenet copy before rollback and avoid editing research pages in an
older client. Raster snapshots do not become vector stroke recordings.

Authentication, district Gateway routing, Socratic policies, retention limits,
existing notebook/history formats, server code, and live demo infrastructure are
unchanged. No new runtime dependency. Root package and lockfile metadata advance
to 1.15.0 for the native build; dependency versions and peer annotations do not.
The native sharing extension accepts only PNG/PDF/.tenet, verifies PNG signature,
keeps 24 MiB PNG/PDF and 64 MiB .tenet caps, and preserves protected temporary-file
and cancellation cleanup. Microphone permission descriptions distinguish local
note dictation from Gateway-bound questions.

## Qualification and publication

Release intended: hosted `tenet-web-v1.15.0`, native 1.15.0 with a new monotonic
build number. Baseline hosted 1.14.0 and native 1.11.0 (51).

Final local full suite: 1,543 tests, 1,539 passed, 0 failed, 4 skipped. This
includes 41 integration tests exercising persistence, undo/redo, page changes,
dictation cancellation, no automatic AI from research edits, and export cleanup.
Browser PNG preparation completed, but the browser automation download event
timed out; actual browser file delivery is not claimed as verified. Browser
verified note add/edit, non-destructive five-section insertion, local save/reopen
with source/text preserved, no console errors, and no horizontal overflow at
1280px and 540px viewport widths. These are browser checks, not physical iPad or
microphone acceptance. No paid live-AI requests were used.

Publication/deployment and Apple processing evidence will be added only after
they complete. Native binary and hosted client identities are independent.
Private host addresses, deployment credentials, receipts, and rollback backups
must not be committed to this public repository.
