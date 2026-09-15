# Tenet Whiteboard 1.8.1: hosted security-policy compatibility

## Why this patch exists

The hosted server applies `frame-ancestors 'none'` to static documents and
permits only same-origin stylesheets and selected style hashes. The 1.8.0
teacher-preview iframe and dynamically inserted style block were incompatible
with those real headers, despite passing the isolated viewer checks.

The 1.8.0 hosted archive was published but was NOT installed on the demo host.
This corrective hosted release uses an in-page, read-only dialog and a
same-origin external stylesheet. The standalone public viewer uses that same
stylesheet. Existing scratch work stays in the current page.

## Deliberate boundaries

- Server CSP, authentication, Gateway rules, service processes, and notebooks
  are unchanged. Weakening framing or allowing unsafe inline styles was rejected.
- Ordinary sessions expose only local archive decoding for this preview, not
  recording, history enumeration, or a new route into IndexedDB student records.
- The synthetic example and explicitly chosen local files are not authenticated
  teacher evidence, full per-stroke replay, or a Schoology submission.
- Native 1.8.0 build 46 remains the paired signed binary. This is a hosted-client
  patch, not a replacement or mutation of an immutable native release.
- Public publication, hosted installation, Apple processing, and installed-iPad
  acceptance must be reported separately.

## Qualification and deployment

Run the complete canonical check and the read-only dialog against the real
strict-CSP policy in a browser before publication. Both Node 22 and Node 24
release gates must pass. Deploy only the immutable archive after comparing the
live previous receipt and backing up every changed path. Preserve service PIDs,
policy bytes, dependency lockfile, and sign-in redirects; retain the guarded
rollback receipt.

## Qualification results, 2026-09-15

`npm.cmd run check` passed: 1,255 tests, 1,252 passed, zero failed, three
existing skips. Focused preview/archive/native contracts passed 45/45. The
native ink/modal suite passed 24/24; these are fixtures, not physical-device
acceptance.

The full local Whiteboard server was exercised with its unchanged production
CSP, isolated temporary state, and no configured AI provider. The teacher dialog
opened with the external stylesheet, decoded its 900x600 checkpoint, exposed the
linked question and Socratic hint, played through 12 events, and closed with the
synthetic rectangle still on the scratch canvas. At 390px viewport width the
dialog client/scroll widths both measured 342px; no horizontal overflow occurred.
The standalone viewer also loaded under the same strict CSP with no console
errors. No hosted inference or real student data was used.

This pass also fixed negative array indices in the existing short-polygon
thinking animation. Positive modulo preserves the intended highlight rather
than shortening it; 20 focused animation/scope tests passed. No AI request scope,
tutoring rule, or response content was changed.

Repeated parallel runs exposed a pre-existing relay test race: real 40ms/55ms
sleeps competed with an 80ms watchdog. The test now combines scoped timer mocks
with real WebSocket hello, ACK, and close events. It asserts survival beyond the
old deadline, expiry at the refreshed deadline, socket closure, and reconnect
scheduling. The production watchdog and all assertions remain; the complete
cloud-connector file passed 50/50. Increasing the timeout or retrying until green
was rejected.

Residual diagnostic: the full app browser logged an unattributed startup
`MutationObserver.observe` target error before opening the preview, including
with the preceding bundle. The expected body and transcript nodes were present;
the tool supplied no exception stack. Preview and scratch transitions worked.
No speculative guard or swallowed exception was added. Its source and relevance
to the physical iPad remain unconfirmed; this is not a zero-console-error claim
for the full application.
