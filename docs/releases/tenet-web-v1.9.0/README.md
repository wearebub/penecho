# Tenet Whiteboard 1.9.0 installed release

- Status: hosted client installed on 2026-09-15 at 18:12:54.615 UTC.
- Immutable source: `feb04e7a86d71b6e2f5bd176eb3e7907454d3e5b`.
- Release: https://github.com/wearebub/penecho/releases/tag/tenet-web-v1.9.0
- Artifact gate: https://github.com/wearebub/penecho/actions/runs/35005636961
- Public preview: https://github.com/wearebub/penecho/actions/runs/35005639926
- Unsigned iPad compile: https://github.com/wearebub/penecho/actions/runs/35005605837

The in-app path is **Pages & files > View work history** on a saved whiteboard,
or **Teacher view** followed by selecting a saved page. New normal saves include
their recorded history; old saves do not gain retroactively invented events.
The public GitHub Pages site intentionally remains a separate synthetic/local-file
viewer and cannot enumerate whiteboards stored inside the iPad application.

## Qualification and scope

Local canonical checks: 1,300 tests; 1,297 passed, zero failed, three existing skips.
Required Node 22 and Node 24 hosted CI passed. The unsigned iPad compile passed;
signed-build and native-release-archive jobs were skipped, as expected for this
client-only change. No new TestFlight binary was uploaded. Existing native pairing:
`tenet-ipad-v1.8.0-build.46`.

The real local browser test created and edited actual work, saved it, reloaded the
application, and displayed its stored actions and full final checkpoint in Teacher
view without replacing the active scratch canvas. Controlled integration fixtures
also exercised native revisions, AI questions/replies, atomic saves, failed saves,
stale capture rejection, and fresh-runtime playback. Physical iPad uptake and
Apple Pencil acceptance remain device checks, not consequences of these tests.

The deployment qualified 38 runtime files with exactly nine changed/added files.
It checked served public asset hashes on ports 3888 and 3889, no-store behavior,
and unchanged unauthenticated 302 responses on the district and Spanish domains.
Service PIDs, district policy bytes and the production package lock were preserved;
no dependencies were installed and no service was restarted.

## Artifact identity

- Release manifest SHA256:
  `6bd87253531af974860a68d8e70b389c3a33e8e6c8192c4a0a1ce2e074e79569`
- Runtime TAR SHA256:
  `e2b4c9d43c4b383c3b48c75b21cd550fadf43f38564db1bd4f94931477e35ed6`
- Served `public/app.js` SHA256:
  `a064754b7197983ca136fcb588c4c37e12dd43c663c88983e42b52e8793c213f`
- Served history viewer SHA256:
  `4e4988e3ef63a84d4e7b9a3fb3cf62cd57b305c40b0cdcb68a5d8e165d70e718`

The adjacent `deployment-receipt.json` records the installed files and checks.
The live receipt and runtime backup are under:
`/opt/tenet-demo/backups/whiteboard-1.9.0-feb04e7/`.

## Rollback warning

The backup restores the exact preceding 1.8.1 runtime and guards against replacing
subsequent changes. It is **not** a backup of local notebook data. The older client
loads existing canvas content but an overwrite omits the new `workHistory` field
and therefore loses that record's saved history. Prefer a forward fix retaining
the new persistence field. Do not resume old-client writes without a separately
qualified complete backup/restore of affected local records and assets.

Code-only rollback, subject to that data warning and explicit operator approval:

```sh
sudo node /opt/tenet-demo/backups/whiteboard-1.9.0-feb04e7/deploy-runtime.mjs rollback
```

See `docs/tenet-saved-history-release-1.9.0.md` for local qualification and the
pre-existing browser observer diagnostic, and
`docs/tenet-saved-whiteboard-history.md` for the recording and privacy boundaries.

## Change rationale

This follow-up records verified deployment identity and the downgrade limitation.
It does not treat a source tag, successful CI, unsigned compile, public sample or
TestFlight baseline as proof of installed-device behavior. No runtime/source code
is changed by this documentation commit; the deployed source stays `feb04e7`.
