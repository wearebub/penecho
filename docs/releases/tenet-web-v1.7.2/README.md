# Hosted Whiteboard 1.7.2

Status: installed and served hashes verified at 2026-09-11T16:51:50.510Z.

- Source: 2864251e589633759a0fb1f7df03a0071940bba6.
- Release: https://github.com/wearebub/penecho/releases/tag/tenet-web-v1.7.2
- Workflow: https://github.com/wearebub/penecho/actions/runs/34624151077
- Annotated tag: 493ebd1b2020059766bc0cc33477824394863613.
- Runtime TAR SHA-256: eab2b97c7520de2c37f00f25c32e53e225b0ab0f7f2751f97f45b0111f805f27.
- Manifest SHA-256: fbb1c27cb670377d525b126bcb68ab695cad212100049431ee4f34814f8b4108.
- Served app.js SHA-256: 49d46c7e8c355a596ccd4e0e848c37e60a5e6019fcb12ae5a107dd1e6e4557e2.

## Change and qualification

Voice no longer clears the transcript and exact selection before a validated reply. Unsuccessful requests retain an explicit retry state. The original physical-iPad first-lasso trigger remains unconfirmed; this release fixes the confirmed silent failure and retry-context loss rather than claiming hardware reproduction.

Local full check passed 1,165 tests with 3 existing skips. A prior local run hit the existing 80 ms relay-heartbeat timing test; its focused rerun and the complete suite rerun passed without changes to the test or relay. Both Node 22 and 24 CI jobs passed on the release source. The first publication attempt was correctly blocked by a packaging assertion left on 1.7.1; the assertion was corrected to 1.7.2, not removed, and no failed-gate build was published.

All immutable release assets were downloaded and checked against GitHub digests, artifact sizes, the release manifest, and the annotated source tag. The deployment verified 31 runtime baselines and refused any changed paths except public/app.js and src/client/app/tenet-voice.js. Only those two files were replaced. Sixteen served-asset checks matched release hashes with no-store; the district and Spanish public origins both retained unauthenticated HTTP 302 sign-in boundaries.

Main service PID 81178, mobile-auth PID 78226, and Caddy PID 54100 remained unchanged. District policy and dependency-lock bytes were preserved. No server files, Gateway keys, authentication, notebooks, or native binaries were changed by the hosted installation.

## Operational decision

This hotfix changes client behavior only. We rejected reusing the previous helper's unconditional demo-host restart because it would rotate internal Gateway keys and reset ephemeral demo state without a server-code change. The version-specific helper retains manifest/baseline checks, atomic file replacement, guarded backup restoration, readiness checks, and served-hash verification, while restricting changed files and requiring identical service PIDs. It never rewrites the live district policy. No live rollback was executed merely for testing.

## Rollback

Previous release: tenet-web-v1.7.1.
Backup: /opt/tenet-demo/backups/whiteboard-1.7.2-2864251.
Receipt: /opt/tenet-demo/backups/whiteboard-1.7.2-2864251/deployment-receipt.json.

After explicit operator authorization, run on the same VM:

```sh
sudo node /tmp/tenet-whiteboard-1.7.2/deploy-runtime.mjs rollback
```

The helper checks deployed identities before restoring the previous bytes. Preserve this release's staging directory and protected backup. Source, IPA, and hosted assets remain independently archived; never move tags or overwrite immutable release assets.

## Native capability pairing

The hosted manifest names the already-published tenet-ipad-v1.7.1-build.41 capability contract. No native capability or notebook-format changes were required. A separate 1.7.2 native build uses the same source and is documented independently; hosted installation is not proof of Apple processing or physical-device uptake.

## Completed native pairing

The same-source native 1.7.2 build 44 is now independently archived under tenet-ipad-v1.7.2-build.44. TestFlight upload succeeded at 2026-09-11T16:55:05Z; see ../tenet-ipad-v1.7.2-build.44 for the signed IPA hash and workflow receipt. Apple processing and installed-device acceptance remain separate from the verified hosted installation.
