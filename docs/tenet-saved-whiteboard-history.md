# Saved-whiteboard work history

## Required experience

Work normally in Tenet Whiteboard, save the page, then choose **View work history**
on that page in **Pages & files**. Teacher view reads the selected saved page's
actual recorded changes and AI assistance without replacing the open canvas.
Reopening the application must not require importing a separate history archive.

This is a local teacher-view demonstration, not screen recording and not a new
authenticated teacher service. The synthetic public example remains a separate
secondary demonstration; it is never a substitute for a saved student's history.

## Root cause of the earlier mismatch

The first implementation supplied a bounded event journal, committed canvas
checkpoints, AI-event observations, and a replay interface. Its writable journal
was a separately gated preview, while the default interface opened sample/manual
archive playback. Ordinary notebook saves therefore did not own their history.
Passing those component tests did not prove the requested saved-page workflow.

## Correction

- Normal Tenet document history uses the existing canvas/native/AI observation
  hooks. No separate Start recording action is required.
- Each local snapshot carries its optional `workHistory` alongside its canvas
  data. History and its assets do not depend on a global journal lookup.
- The normal save/load path serializes and restores that document's history.
  Notebook autosave also considers history-only changes, such as AI assistance.
- Each notebook page has a touch-sized **View work history** action. The teacher
  dialog lists saved whiteboards and reads the chosen save without loading it
  into the student's active editing surface.
- Missing, partial, and legacy history must be described honestly. Changes made
  before recording existed cannot be reconstructed from a final drawing.

## Boundaries

Recorded events and checkpoints are observable application actions, not video or
proof of authorship. A checkpoint is a captured committed page state, not a claim
that every intermediate Pencil movement was retained. Pauses, corrections, and AI
events must not be presented as evidence that a student cheated or worked without
outside assistance. Unobserved intervals and storage/size limits require explicit
coverage limitations.

History remains in the existing local notebook storage. This change does not add
student-work uploads, raw microphone recordings, analytics, LMS submission,
school rostering, remote teacher authorization, or cross-device synchronization.
The district Gateway and tutoring-policy enforcement remain unchanged.

## Alternatives rejected

Enabling the old global preview journal would not make a saved document
self-contained and would widen an intentionally gated storage surface. Making a
synthetic example look more realistic would still fail the requirement. Screen
recording would collect unrelated UI/audio information and would be harder to
query than actual canvas and AI events.

## Qualification required before release

1. Produce real canvas changes and AI events through their normal observation
   paths, save, restore in a fresh application context, and read the same save.
2. Confirm a new page cannot inherit another page's in-flight events/assets.
3. Confirm failed saves retain pending work and legacy saves do not gain invented
   history.
4. Open a saved page from the notebook in the real app, reload, and inspect its
   recorded checkpoints in Teacher view rather than a synthetic sample.
5. Exercise native modal hit-testing, strict CSP, full canonical checks, and the
   release's exact source/artifact identity before deployment.

Physical iPad acceptance remains distinct from automated/browser qualification.
Release receipts must state which checks passed and whether a signed native build
or only the hosted Whiteboard client changed.

## Downgrade boundary

Source inspection of the installed 1.8.1 baseline (`20899b1`) confirms that its
loader ignores the optional top-level `workHistory` and reads existing canvas
data. Its save path, however, constructs a new snapshot without that field and
replaces the IndexedDB row. Overwriting a 1.9.0 save with that older client would
therefore discard the saved action history and attachments. Loading alone does
not do that in the inspected path; a physical old-client downgrade was not run.

The versioned runtime backup is a **code rollback**, not a local student-data
backup. Prefer a forward fix that preserves the new persistence field. Do not
resume old-client writes against new history-bearing saves without a separately
qualified complete backup/restore of the original records and history assets.
PDF/PNG exports do not preserve this process history, and no complete history
backup/export workflow is claimed by this release.
