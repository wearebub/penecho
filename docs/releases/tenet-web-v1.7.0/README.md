# Hosted Whiteboard 1.7.0

Status: installed and served hashes verified at `2026-09-10T22:56:08.418Z`.

- Source: `e7fdf111681be974fa54f047d233b83a32f2b510`.
- Release: https://github.com/wearebub/penecho/releases/tag/tenet-web-v1.7.0
- Workflow: https://github.com/wearebub/penecho/actions/runs/34539541499
- Annotated tag: `79a19478b3c2dc561f37bf2b1a0e19c568309bbc`.
- Runtime TAR SHA-256: `4ca02649e2c857eba775f9bb07ed5e9f09d55599c47493eeae33b96c8e7ecf9a`.
- Manifest SHA-256: `3dca13be0131e6e0d224b91be2269e89f72f17a8fcbde1f85f7a46c699585888`.
- Served app.js SHA-256: `454bfee7f62036cd4c098598b52168c1ac2b96aea901c3b80561b30cc64d644a`.

Local full check: 1,155 passed, zero failed, three existing skips. Hosted CI
passed on Node 22 and 24. Downloaded release assets match GitHub digests and
the release manifest; the annotated tag resolves to the exact source commit.

## Live qualification

Installed 31 explicit runtime files on `tenet-gateway-demo` in
`tenet-connect-demo`, `us-central1-a`. Sixteen served asset checks matched
release hashes on district/Spanish instances. Both public origins retained
their unauthenticated 302 sign-in boundary. The main service PID changed from
73141 to 74206. Mobile auth stayed PID 60559; Caddy stayed PID 54100. No auth,
Caddy, dependency, notebook, credential or district-policy changes were made.

An operator-loopback synthetic blank-page request through the deployed server
and Gateway returned HTTP 200 and one `write_text` command at
`2026-09-10T22:59:36.115Z`, request
`128fc24e-8354-48c2-a4bd-1b3c91dce16d`. No image was attached. See
`live-text-smoke.mjs` and `live-text-smoke.json`. This does not replace public
sign-in or physical microphone acceptance.

The deployment guard first rejected the copied helper's stale 29-file limit,
before creating a backup or stopping the service. The final helper here uses
31, explicitly including the selection renderer and new text-only server
module. This receipt's helper is the qualified operational copy; the candidate
source ZIP predates that operational-only count correction.

## Rollback

Previous installed release: `tenet-web-v1.6.0`.
Backup: `/opt/tenet-demo/backups/whiteboard-1.7.0-e7fdf11`.
Receipt: `/opt/tenet-demo/backups/whiteboard-1.7.0-e7fdf11/deployment-receipt.json`.

After operator approval, run on the same VM:

```sh
sudo node /tmp/tenet-whiteboard-1.7.0/deploy-runtime.mjs restore
```

The helper checks current hashes before restoring previous bytes, removes only
the newly introduced file recorded in this receipt, restores policy bytes and
verifies readiness/served assets. It refuses unrelated drift. Do not run an
older deployment's restore helper to undo this release. No rollback was
performed as part of qualification.

## Native pairing

Hosted 1.7.0 was deliberately deployed while 1.6.0 build 36 remained installed,
before dispatching the 1.7.0 native build. Both capability contracts are supported.
Native workflow: https://github.com/wearebub/penecho/actions/runs/34539845278.
The paired iPad release is `tenet-ipad-v1.7.0-build.40`, from the same source,
with successful TestFlight upload at `2026-09-10T23:02:28Z`. Its immutable
artifacts and final upload receipt are recorded separately.
Hosted deployment alone cannot update native microphone behavior.
