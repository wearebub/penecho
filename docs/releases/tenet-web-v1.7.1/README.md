# Hosted Whiteboard 1.7.1

Status: installed and served hashes verified at 2026-09-11T15:12:54.615Z.

- Source: b9fb0ee7f1bf0db0ed996912c3e64788fd14666e.
- Release: https://github.com/wearebub/penecho/releases/tag/tenet-web-v1.7.1
- Workflow: https://github.com/wearebub/penecho/actions/runs/34613961168
- Runtime TAR SHA-256: 464531a96a39f5b8a9ca62f136d8d40f264c8a2c04ef6e6d79d0380c8a86ca09.
- Manifest SHA-256: 334cfce1da84bc3e2076c7430b9e6d5642d21ceb59fbb7927ea05345fa9d0184.
- Served app.js SHA-256: dc7354ceb0d8d96dd97b41a9c441ea59ae2acde114d91cc87abb165c8705cfd9.

## Live qualification

Installed 31 explicit runtime files on tenet-gateway-demo in tenet-connect-demo, us-central1-a. Sixteen district/Spanish served-asset checks matched release hashes; both public origins retained unauthenticated HTTP 302 sign-in boundaries. The main service changed PID 78455 to 81178. Mobile auth remained PID 78226; Caddy remained PID 54100. The helper verified dependency-lock preservation and restored the exact district-policy bytes after the demo host restart. Restarting this demo host rotates internal Gateway keys and resets ephemeral demo state; no notebook, auth-service, Caddy, or dependency changes were made.

Direct transfer failed before installation. The authenticated IAP tunnel completed staging and preparation. The install then succeeded exactly once; the local Cloud SDK crashed while collecting its receipt, so only receipt retrieval was retried via the cached-host-key SSH connection. No second install, daemon-reload, or rollback was performed.

Local full check: 1,162 passed, zero failed, three existing skips. Hosted full CI passed on Node 22 and 24. Release assets were downloaded and matched GitHub digests and the manifest; the annotated tag resolves to the exact source commit.

## Rollback

Previous installed release: tenet-web-v1.7.0.
Backup: /opt/tenet-demo/backups/whiteboard-1.7.1-b9fb0ee.
Receipt: /opt/tenet-demo/backups/whiteboard-1.7.1-b9fb0ee/deployment-receipt.json.

After explicit operator approval, run on this VM:

```sh
sudo node /tmp/tenet-whiteboard-1.7.1/deploy-runtime.mjs rollback
```

Use this release's helper, not an older release's helper. The supported command is rollback; the older 1.7.0 README's restore spelling was incorrect. The guard refuses unrelated drift before restoring previous bytes and checks readiness and served assets. No live rollback was executed during qualification. Preserve the backup and this release's staging files; immutable release assets provide the recovery source if staging must be recreated.

## Native pairing

This web release was packaged against the existing 1.7.0 build 40 capability contract while the new native build ran. Native 1.7.1 build 41 is now independently archived from the same source commit, with TestFlight upload success at 2026-09-11T15:13:32Z. Its upload receipt and artifact hashes are under ../tenet-ipad-v1.7.1-build.41. Apple processing and installed-device behavior are not established by these receipts.
