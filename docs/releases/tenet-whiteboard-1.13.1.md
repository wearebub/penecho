# Tenet Whiteboard hosted 1.13.1

## Scope and engineering decisions

Protect saved replay history when the same local whiteboard is saved again.
Paired native release remains `tenet-ipad-v1.11.0-build.51`; this hosted client
patch does not require a new TestFlight binary.

Root cause: a save could replace the durable page with a snapshot lacking its
history, and the quota/clone-error retry explicitly dropped all recorded history
and attachments. There was no continuity guard in the overwrite transaction.

The save now reads and checks the durable history inside the same read/write
transaction as the page and tile update. Missing, reset, divergent and stale
histories abort without replacing the earlier save. Quota and clone failures
leave the previous save intact and newer work unsaved in the open page, with a
retry message. The compatibility fallback no longer removes history or marks
unsaved work as saved. Legitimate, explicitly marked bounded prefix retention
continues to work.

Rejected: silently saving without replay, raising browser quota/retention limits,
or blindly merging concurrent histories. Those would lose evidence, conceal a
failed save, increase resource risk, or invent an ordering between writers.

Intentionally unchanged: existing page IDs, snapshot/history formats, explicit
retention limits, account/page lifecycle fences, Gateway policy, authentication,
AI submission, native PencilKit/voice and services. The read-only public Teacher
Preview is unchanged because this defect is in the active canvas save path.
Already overwritten history is not reconstructed by this patch. An older .tenet
or embedded-history PDF export may still contain a surviving earlier copy.

## Qualification

- Focused save/history suites: 54 passed, zero failures or skips.
- Full `npm.cmd run check -- --test-concurrency=1`, including the existing real
  .tenet import regression artifact: 1,463 tests, 1,460 passed, zero failed,
  three skipped.
- Added regression cases for repeated overwrite and reopen/save, quota and clone
  errors plus retry, missing/reset live history, stale concurrent writers,
  legacy pages, and explicit bounded retention. Earlier event JSON and unique
  attachment bytes are retained in the multi-save integration case.
- Real browser UI on an isolated loopback app: draw/save, draw/save over the
  same page, reload/open/draw/save. Teacher View retained the original first
  observation and grew from 4 to 9 to 14 observations, with three checkpoints.
  Synthetic provider only; any Auto AI request fails locally, never reaches a
  district or external AI provider. This is not native-iPad acceptance.
- Historical source-shape tests and transaction mocks were updated to exercise
  the actual guarded read/abort/write lifecycle, not to bypass failures.

## Publication and rollback

Publish immutable `tenet-web-v1.13.1` after hosted Node 22/24 CI. The only runtime
changes are `public/app.js`, `src/client/app/persistence.js`, and
`src/client/app/tenet-document-history.js`.

Baseline source: `607673d7b981a3ad9fec9f22bc201b6a057e1c40`.
Baseline receipt:
`/opt/tenet-demo/backups/whiteboard-1.13.0-607673d/deployment-receipt.json`.

Deploy only those three manifest-qualified files. Preserve service PIDs,
Gateway policy and dependency lock. Verify served file hashes, no-store caching,
authentication redirects and readiness before recording success. Keep the prior
files and a guarded rollback command in the new deployment receipt. Rolling
back code does not recover already-lost data and would reintroduce this defect;
protect/export notebook work before any operator rollback.
