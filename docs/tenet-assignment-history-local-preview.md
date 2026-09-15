# Assignment history: local implementation slice

Date: 2026-09-15
Status: local implementation, not a district-ready assignment system or release.

The scratch-work iPad demo stays unchanged by default. This separate preview requires both `PENECHO_CONFIG.tenetMode === true` and `PENECHO_CONFIG.tenetAssignmentPreview === true` in an explicitly configured development/preview host before the client bundle loads. Without that opt-in there is no Work history button, no journal initialization and no assignment capture. The flag is a rollout switch, not an authorization or policy boundary. Do not enable it on the current district demo merely to show progress.

## Why this change exists

Overwrite saves and the editor's bounded undo stack do not provide a durable record of a student's process. This slice adds a separate explicitly enabled local history without changing saved notebooks, AI permissions or the existing ink renderers.

## Included

- A separate IndexedDB journal with transactional event sequencing, hash-linked events, content-addressed attachments and profile/attempt limits.
- One writer per attempt; explicit interrupted-capture recovery marks a coverage gap rather than silently resuming.
- A Work history dialog to begin capture on the current page, inspect recorded events and checkpoints, pause, freeze a local revision, export/share an archive, and open an archive read-only.
- A portable versioned `.tenet-work.json` file containing event history and supported attachments. The importer checks internal hash/order consistency, not student identity or independent authorship.
- Explicit local-only status, no implicit upload, no teacher enforcement claim, and no personal notebook migration.
- A separate `public/tenet-history-viewer.html` read-only archive viewer for a teacher's browser. Its generated JavaScript includes only journal archive handling and the viewer UI, not the canvas, microphone, account, or AI runtimes. It does not list the profile's local histories or initialize their database. The user chooses a file to inspect in memory.

The capture adapter documents the actual observed commit boundaries. Rendered checkpoint history is not a guarantee of every individual PencilKit stroke. The native durable stroke writer and fully normalized cross-platform stroke replay described in the proposal remain additional work.

## Intentional boundaries

This is a synthetic-data preview. Browser-profile storage is not school-account isolated. No district assignment session, server-enforced assignment phase, synchronized teacher access, policy receipt, Schoology connection, automatic hand-in or longitudinal learner profile is implemented here. Existing district AI rules and hint behavior remain unchanged.

No private inference about cheating, other applications or a student's ability is made. Native drawing archives and recorded local checkpoints stay on the device unless the user explicitly exports or shares them. An export leaves live revocation control. No raw microphone audio is collected for work history.

Limits: 100 local attempts, 5,000 events per attempt, 64 MiB per attempt, 256 MiB per browser profile, and 32 MiB of assets per append. Hitting a limit stops capture and requires attention; there is no silent eviction. Existing canvas work is not deleted to make space.

## Alternatives rejected

Reusing mutable undo as permanent evidence, polling the whole page on a timer, treating a client hash as a school signature, silently resuming capture on a different page, and exposing a local phase dropdown as if it controlled district rules were rejected. A documented JSON archive is the first portable format; a ZIP container and PDF/report appendix remain later export work.

## Qualification and delivery

New runtime source is included by `scripts/build-client.js`. Generate `public/app.js` through that script, never by hand. No test or device qualification is implied by generating the bundle. Native microphone changes additionally need macOS compilation, signing and a TestFlight upload; the hosted client also needs its normal backed-up deployment before the iPad receives new web UI.

The full engineering proposal is at `C:/Users/caleb/TrueMadeAI/Coding/monorepo/docs/engineering/tenet-assignment-work-history-and-schoology.md`. Server policy, tenant isolation, native journaling and Schoology integration must pass their proposal gates before using this preview for actual retained student records.
