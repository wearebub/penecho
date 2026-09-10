# Tenet Whiteboard 1.7.0

## Root causes and changes

- Voice recording was coupled to optional canvas previews. It now starts once
  native listeners and current microphone capabilities are ready, independently
  of preview loading. Sending still flushes ink and checks page revisions.
- Acoustic silence was not the desired interaction. Native speech now starts
  finalization after 1.5 seconds without a changed normalized word sequence.
  Duplicate callbacks, case and punctuation do not postpone submission. The
  final transcript and stop reason travel together to avoid event-order races.
- Blank questions used an image-only request contract. Explicit questions on
  genuinely blank rendered pixels now use a strict text-only branch, with no
  image fields or provider image blocks. Missing referenced problem context
  prompts a clarification rather than invented page content. Image capture
  failures never silently discard a nonblank page.
- Selection processing visuals used recent-ink geometry instead of the request
  polygon. The renderer now receives immutable, lifecycle-guarded request scope
  and clips to that exact polygon with the current viewport transform.
- Native ink locks and coarse object hit expansion could consume HTML control
  taps. Controls bypass canvas locks and receive bounded native exclusion
  rectangles. Overflow hides the native input surface rather than dropping
  exclusions. No synthetic duplicate submit handler was introduced.
- Circle capture could retain stale pointer state or replace a completed lasso
  accidentally. Release/lost-capture ordering, explicit redraw, page and
  background guards now preserve a stable selection.
- Action labels were not an authoritative tutoring policy. The server
  normalizes tutoring actions and applies minimum-hint schoolwork rules to all
  render formats and retries. Legacy answer is not a worked-solution bypass.
  The separate unrestricted PenEcho Agent is refused in Tenet mode.
- Talk and Circle entry points now use accessible microphone/lasso graphics;
  Talk shows a listening state. Context actions remain readable.

## Considered and rejected

Do not send partial speech as final after a timeout: offer review instead.
Do not drop canvas context on capture errors: fail visibly. Do not widen an
invalid or stale lasso to a whole-page request. Do not solve touch problems by
duplicating browser clicks or weakening palm rejection. Do not rely on hiding
an Answer button as a policy boundary. Preserve old native capability handling
so the hosted update can precede the new TestFlight binary.

## Intentionally unchanged

Both Web and PencilKit remain available. Notebook schemas, local saved work,
authentication, provider credentials, dependencies, audio privacy and district
Gateway routing are unchanged. Audio stays in native on-device recognition.
No central class-rule synchronization or universal model-compliance guarantee
is claimed. Desktop version remains 1.2.0; root/iPad/hosted version is 1.7.0.

## Qualification and rollout

Local qualification: `npm.cmd run check` passed with 1,155 passes, zero failures
and three existing skips (1,158 total). This includes a real local HTTP request
through the Whiteboard server to a synthetic provider, not merely extracted
helper tests. It verifies text-only transport, the full tutoring/schema budget,
valid response placement, and rejection of empty or mixed image payloads.
The HTTP test caught and drove a fix for a remaining image-coordinate assumption
in text-only response placement. A browser pass exercised drawing, welcome
dismissal, Circle selection and the selected-area question popup.

Release is gated on the full client/server test suite and Node 22/24 CI. Native
publication additionally requires Simulator compilation, signed IPA verification
and a successful TestFlight upload command. Exact commits, artifact hashes,
served-file hashes and rollback paths belong in docs/releases records.

The hosted release is initially paired with the existing immutable 1.6.0 build
36 for upgrade compatibility and is deployed before dispatching the new 1.7.0
native release. The final release receipt records the new native build too.

Physical iPad acceptance remains distinct from CI: granted-permission startup,
word-pause finalization, finger/Pencil buttons, native thickness, and concave
lasso voice scope must still be exercised on a device. A 1.5-second word pause
starts finalization; recognition can add latency, and a finalization timeout
offers manual review rather than auto-sending unfinished speech.
