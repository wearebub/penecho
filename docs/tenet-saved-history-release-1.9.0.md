# Tenet Whiteboard 1.9.0 qualification

Date: 2026-09-15. This record describes source/local qualification before hosted
promotion. The immutable release and live installation receipts are separate.

## What changed and why

The earlier Teacher preview demonstrated the recorder/viewer components but did
not attach them to normal saved whiteboards. This release adds automatic
document-owned history in `snapshot.workHistory`, shared save/load integration,
saved-page browsing in Teacher view, and a notebook History action. It rejects
sample-only proof and leaves the legacy preview journal's gate unchanged.

Local history can contain committed edits, undo/redo, accepted native revisions,
AI request/response/finish events, and bounded page checkpoints. It is not video,
every raw Pencil point, proof of authorship, or an authenticated LMS teacher API.
District Gateway routes, rules, identity checks, microphone processing and native
binary code are unchanged.

## Local checks

- `npm.cmd run check`: 1,300 tests; 1,297 passed, zero failed, three pre-existing
  skips. Log: `%TEMP%/tenet-1.9.0-qualified-check.log`.
- Native/history integration: 36 focused tests passed. These exercise the real
  history engine, native receive path, export renderer, canvas encoding wrapper,
  save/load functions and two-store persistence transactions with controlled
  browser/native/IndexedDB fixtures.
- Negative cases include stale page changes, mutation during capture, failed
  native flush, aborted storage transactions, renderer failure, invalid assets,
  legacy/missing history, and a cold native baseline acknowledgement.
- Teacher UI timestamp regressions: ISO timestamps and legacy numeric device
  times work; malformed/missing times show `Time unavailable`, never `Invalid Date`.

## Actual browser workflow

Used the real application/server on loopback port 4179, with strict server CSP and
synthetic test work only. No hidden page-state injection or sample substitution.

1. Created a page before automatic capture and saved it as a legacy fixture.
   After updating the client, Teacher view listed it and explicitly reported no
   available history rather than inventing steps or substituting a sample.
2. In the new client, inserted a rectangle, named/saved the page, drew ink through
   real pointer input, used Undo and Redo, and saved through normal UI controls.
3. Reloaded the entire application, opened Pages & files, and selected that save's
   History action. The saved events and images were available while the current
   blank scratch canvas remained unchanged.
4. Loaded the original saved canvas, added more real ink, and saved again. A fresh
   application reload restored a 21-event history and the final rectangle, check
   mark, circle and line as a decoded checkpoint image in Teacher view.

Rapid edits initially invalidated an in-flight checkpoint correctly. That test
also exposed that Save used a thumbnail even when a better final frame was
possible. Save now reuses a current full PNG or captures a fresh full final frame;
it refuses a changing capture rather than re-stamping it as the saved revision.
Earlier partial records retain their truthful gap disclosures.

Successful AI request/reply persistence was exercised in controlled integration
fixtures, not via a paid live-provider call in this browser session. Physical
Apple Pencil/iPad acceptance is not implied by desktop or fixture checks.

## Residual diagnostic

The full browser app still reports the previously observed asynchronous
`MutationObserver.observe` non-Node error. It was present in the prior client
before this feature, and the browser runtime did not expose a useful stack.
The actual save/reload/viewer workflow completed despite it. No speculative
observer guard or swallowed exception was added, and no zero-console-error
claim is made for the full application.

## Deployment and rollback boundary

This is a hosted-client release paired with the existing signed native baseline
`tenet-ipad-v1.8.0-build.46`, not a new TestFlight binary. Immutable artifact CI,
hosted file hashes, existing authentication redirects, policy bytes, service PIDs
and the production package lock must be qualified during promotion.

The runtime rollback restores code only. Source review of 1.8.1 (`20899b1`) shows
that it loads existing canvas data but overwrites snapshots without carrying
`workHistory`. Do not call that downgrade history-preserving. Prefer a forward
fix retaining the new field; protect complete records/assets before any old-client
writes. PDF/PNG is not a process-history backup. See
`docs/tenet-saved-whiteboard-history.md` for the full boundary.
