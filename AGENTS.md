# PenEcho / Tenet Whiteboard agent instructions

## Standing approval for testing

The user has explicitly authorized routine testing of requested implementation
changes. Add or update scoped regression tests and run the relevant tests and
build checks before reporting a change ready or asking about next steps.
Do not ask the user whether to test code they asked you to change.
Fix release-blocking defects within the authorized scope and rerun failed checks.
If a check cannot run, report the blocker and do not claim it passed.

This approval does not authorize destructive data operations, paid live AI calls,
new credentials, unrelated production changes, or publication that was not
requested. Seek clarification for materially different scope or consequences.
When publication is requested, test first and publish only after required checks
pass. Distinguish local/browser results, hosted CI, deployed artifacts and
physical-iPad acceptance. Never call a hosted client update a new TestFlight build.

## Existing project boundaries

Use `npm ci` for installs. Do not commit npm-version peer-annotation churn.
Preserve unrelated work. Keep saved notebooks, replay history, authentication and
Gateway policy intact unless the requested change specifically concerns them.
Before releasing, read `docs/tenet-whiteboard-releases.md` and the latest release
record in `docs/releases/`; use an immutable version and a guarded rollback record.
Explain the root cause, rejected alternatives and intentionally unchanged behavior
in the change description or commit message. Never silently discard history to
make a save or test pass.
