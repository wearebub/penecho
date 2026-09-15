# Tenet Whiteboard 1.8.0: teacher preview

## Scope and access

This testing release adds an explicitly labeled teacher-style viewer for a
synthetic assignment and user-selected local history archives. It does not
create teacher authorization, connect a classroom, or expose student records.
The existing scratch-work canvas and district sign-in boundaries remain intact.

The public site publishes only the read-only viewer HTML, its generated script,
and a source-commit receipt. It has no notebook upload service. Opening an archive
is local browser processing; selecting a file does not send its content to Tenet,
GitHub, an LMS, or an AI provider. Normal page requests still reach the host.

Live local capture remains disabled unless the existing explicit
`tenetAssignmentPreview` configuration is true. Capture also requires opt-in;
it must not be enabled for real student data before school-account isolation,
retention policy, and access controls have been implemented and qualified.

## What the viewer means

- Page images are coalesced checkpoints, not every individual pen movement.
- AI entries show observations captured by the app, not independently verified
  Gateway evidence or a complete account of help received elsewhere.
- Internal hash consistency is not proof of authorship or server authenticity.
- Missing checkpoints and storage failures must remain visible as coverage gaps.
- A local frozen archive is not a Schoology submission or a teacher receipt.

## Release and rollback

Native and hosted releases use separate immutable tags. Both require full
Node 22/24 CI; native signing also requires successful simulator compilation.
TestFlight upload, Apple processing, and physical-iPad acceptance are distinct.

The public viewer workflow runs only its checks on registration pushes and
publishes only on explicit dispatch. Its artifact allowlist excludes repository
source, authentication configuration, signing credentials, and local archives.
The workflow follows GitHub's [Pages workflow guidance](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

Hosted client deployment must compare the live previous-release receipt, verify
the immutable manifest and TAR hashes, back up every changed path, and preserve
service PIDs, policy bytes, dependencies, and notebook data. No server restart is
needed for this client-only installation. Keep the old receipt for guarded rollback.

## Engineering decisions

Root cause: a proposal and an opt-in recorder did not provide an accessible,
qualified way to demonstrate a teacher's view of the work. Voice terminal paths
also needed regression coverage and clearer failure handling.

Rejected: globally turning on unscoped student-history capture, weakening school
sign-in to make a public demo, claiming checkpoint playback as full stroke history,
or skipping CI in order to publish quickly.

Intentionally unchanged: Gateway rules and tutoring policy, school identity,
existing notebook formats, speech privacy, and LMS submission. Native microphone
behavior still requires physical-device qualification; JavaScript tests and a
successful Swift compile cannot prove the reported instant-stop symptom resolved.

## Local qualification, 2026-09-15

`npm.cmd run check` passed: 1,247 tests, 1,244 passed, zero failed, and three
existing skips. An earlier parallel run hit the pre-existing relay-heartbeat
80 ms timing flake; the unchanged canonical suite passed on retry. No heartbeat
assertion, timeout, or test was removed or weakened.

Browser qualification covered a 1280x960 viewport and a 390x844 narrow viewport:
synthetic preparation, playback through all 12 events, a decoded 900x600 page
checkpoint, linked question/reply evidence, no horizontal overflow, and no
console errors. The iframe entry and native modal boundaries have behavioral
fixture coverage; physical Apple Pencil, Safari persistence, and microphone
hardware behavior remain separate device checks.

The focused journal suite enforces the 12 KiB UTF-8 event-detail limit for
imports as well as writes. Strict CSP remains unchanged; launchers use classes,
not full inline-style attribute writes. A hashed archive is internally consistent,
not independently authenticated student evidence.
