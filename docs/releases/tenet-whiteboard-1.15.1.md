# Tenet Whiteboard 1.15.1: Plan & Write

## Root cause

The Research label was narrower than the workspace: students also brainstorm,
organize ideas, and plan writing. The toolbar button and accessible dialog title
now both say Plan & Write. Related guidance, empty states, errors, default note
names, and the Topic organizer use consistent student-facing language.

## Rejected alternatives and preserved boundaries

Rejected renaming source files, DOM IDs, the TenetResearch bridge, template IDs,
or the version-1 tenetResearch saved-data field. Those are compatibility contracts,
not student-facing branding. Existing notes, citations, undo/redo, local saves,
exports, dictation, AI/Gateway routing, and district rules are unchanged.

This is a hosted-client patch paired with native tenet-ipad-v1.15.0-build.58.
The existing iPad app receives the name on a fresh canvas load; no new TestFlight
binary or package-version bump is needed. Existing native permission text describes
research-note dictation as an activity, not a navigation label, and is unchanged.
The historical 1.15.0 release record retains the name that release actually used.

## Qualification

Local full check: 1,544 tests, 1,540 passed, zero failed, four skipped. The client
bundle was rebuilt from canonical sources. This includes the new naming and
saved-data compatibility regression.

Regression coverage pins the new visible and accessible names while retaining the
existing bridge, DOM IDs, and template identifiers. Run the full local and cloud
checks before publishing tenet-web-v1.15.1. Deployment uses the 1.15.0 receipt as
its baseline, verifies all 43 runtime files, and changes only public/app.js and the
two existing workspace source modules. No added files, service restart, server
changes, dependency updates, notebook-data changes, or policy changes are needed.

Publication and deployment evidence belongs in the immutable release provenance
and its release notes once completed; physical-device acceptance is separate.
