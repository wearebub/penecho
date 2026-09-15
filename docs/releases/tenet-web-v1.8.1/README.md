# Tenet Whiteboard hosted release 1.8.1

Installed on 2026-09-15 at 17:22:28 UTC from immutable source
`20899b1c7214a0ea67c9b503f06822e3fa25c478`.

- Hosted archive: https://github.com/wearebub/penecho/releases/tag/tenet-web-v1.8.1
- Required Node 22/24 CI and archive: https://github.com/wearebub/penecho/actions/runs/35000567508
- Public viewer: https://wearebub.github.io/penecho/
- Public viewer CI and deployment: https://github.com/wearebub/penecho/actions/runs/35000570334
- Paired signed native binary: https://github.com/wearebub/penecho/releases/tag/tenet-ipad-v1.8.0-build.46

Native 1.8.0 build 46 was signed, verified, and uploaded to TestFlight in run
34997072757. Apple processing and installed-device acceptance are not confirmed
by that upload. Hosted 1.8.0 was archived but never installed; immutable tags and
assets were not replaced. This 1.8.1 patch requires no new native binary.

## Evidence

Canonical check: 1,252 passed, zero failed, three existing skips. Hosted and
public publication independently passed their Node 22 and Node 24 CI gates.
Browser qualification, scope, and remaining diagnostics are recorded in
`docs/tenet-teacher-preview-release-1.8.1.md`.

Manifest SHA256:
`cd9ec5b9180e05a56577efba6ee8d0615e4e8c29696149616201a48d3dd3f4d0`

Runtime TAR SHA256:
`9f54cd0565e2699c211ad2e336448c107612e4355d7a4024d82da97a90b4b326`

Both hosted listeners served the expected app bundle:
`59d64e356ff70fa7b4ab3f01724985b6e1a1ed699b3385a07545be55f46795b4`.
All 37 runtime files matched the manifest; only 14 approved paths changed.
Both public district origins retained unauthenticated HTTP 302 responses.
Service PIDs, policy bytes, and dependency lockfile were preserved.

The public receipt points to the same source commit. Its served viewer JS and
CSS hashes match the hosted release. The preview supports synthetic playback
and explicitly chosen local archives; real student capture stays disabled in
ordinary sessions. It is not a connected classroom, authorized teacher report,
full per-stroke recorder, or Schoology integration.

## Guarded rollback

The previous installed runtime is `tenet-web-v1.7.2`. Backup and deployment
receipt live at `/opt/tenet-demo/backups/whiteboard-1.8.1-20899b1/` on
`tenet-gateway-demo`, project `tenet-connect-demo`, zone `us-central1-a`.

After explicit rollback authorization, run on that host:

```sh
sudo node /opt/tenet-demo/backups/whiteboard-1.8.1-20899b1/deploy-runtime.mjs rollback
```

The helper refuses later file drift, restores exact previous bytes, removes only
its own new files, and verifies served hashes and unchanged process identities.
Do not restart the Gateway, reset the checkout, or move immutable release tags.
