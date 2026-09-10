# Tenet Whiteboard hosted runtime 1.4.0

Installed on 2026-09-10 at 18:04:33 UTC.

- Immutable release: https://github.com/wearebub/penecho/releases/tag/tenet-web-v1.4.0
- Source: `6c2d434b53a9c5b66efb765f37381594b6c57d73`
- Qualified workflow: https://github.com/wearebub/penecho/actions/runs/34511290950
- Native pairing remains `tenet-ipad-v1.3.0-build.25`. No new TestFlight binary was uploaded.
- Runtime archive SHA-256: `42e37a27749d9be5b1fce77e50aa002ae372b5ac72f07be23931f6a90bf1e36d`
- Release manifest SHA-256: `c1c346b8163712be197f181ce841d13a35fc10f914db69a88417e8e732f7213e`
- Served application SHA-256: `d7d1b1b45b7f7faaf44c364fef98ec347642dd9f0e99fae2003c57db192fca0f`

## Scope and reasons

Quick AI previously captured the visible page instead of recent writing; illustrations carried invalid empty graph metadata when accepted. Native ink also shared web-only controls, and object resizing exposed too few handles. This release adds circled-only AI questions, bounded server-rasterized illustrations, explicit recent/page context, a visible thickness chooser, engine-specific controls, 33 local shape/graph templates, and eight-direction resizing using the existing history model.

We rejected weakening image validation, passing raw PencilKit archives to AI, bypassing district rules, and replacing the object/history architecture. Authentication, Gateway policy code, native Swift, dependencies, and notebook data were intentionally not changed. The 3D choices are static coordinate/geometry templates, not an interactive 3D graphing engine. Accepted text that is flattened into ink remains ink; the new response handles apply to editable drafts and persistent image/widget objects.

## Qualification

- Local build and full check: 1,036 tests, 1,033 passed, zero failed, three skipped.
- Required GitHub Node 22 and Node 24 jobs passed before immutable publication.
- Browser: all eight pointer drag directions, resize undo/redo, compact Insert search, thickness presets, circle plus typed question, illustration acceptance, save, full reload, and Device-library reopen.
- Layout checked at 1024x768 and 768x1024. Physical iPad Pencil/finger behavior is not claimed from browser tests.
- The illustration round trip used an isolated synthetic provider. Live model quality and physical-device acceptance remain separate checks.
- An unlocated MutationObserver error appeared once in browser tooling without a source URL or stack. Tested flows completed, but this record does not claim an entirely clean browser console.

## Deployment evidence

The exact 27-file runtime was installed on `tenet-gateway-demo`, project `tenet-connect-demo`, zone `us-central1-a`, under `/opt/tenet-demo/penecho`. Both loopback Whiteboards (3888 and 3889) served matching public-file hashes with `no-store`; both public domains retained the unauthenticated 302 sign-in boundary. The plain comparison instance on 3890 also reached readiness.

This was a coordinated restart of `penecho-demo`, which also owns the synthetic Gateway process. Its PID changed from 65067 to 70061. Internal demo Gateway keys rotated and ephemeral demo state reset; the pre-deploy rule file was restored byte-for-byte. The auth service remained PID 60559, and Caddy remained PID 54100. No notebook or package-lock files were replaced.

Systemd reported a pending on-disk unit/drop-in change. No `daemon-reload` was performed: applying unrelated service-definition changes was outside this deployment. The loaded service definition started successfully.

The hosted server baseline lacked only previously committed Check/Practice routing. A previously absent selection stylesheet is now included in the runtime archive. All other existing files were checked against their qualified baselines before replacement. A preparation attempt stopped safely because the operator's default subprocess buffer could not hash the large old application bundle; no runtime files were changed by that failed preflight. The baseline calculation was rerun with an explicit large buffer and missing-file handling.

## Rollback

Backup and authoritative receipt:

`/opt/tenet-demo/backups/whiteboard-1.4.0-6c2d434/deployment-receipt.json`

The backup directory contains `previous/`, `next/`, the pre-deploy policy, deployment helper, and configuration. Copies of the helper, configuration, and receipt are committed beside this document; they contain no provider credentials.

With explicit rollback authorization, run on the VM:

```sh
sudo node /opt/tenet-demo/backups/whiteboard-1.4.0-6c2d434/deploy-runtime.mjs rollback
```

The helper refuses to overwrite later file changes, restores the prior files, removes only newly introduced release files, restarts the demo host, restores the saved policy, and checks the old served hashes and public auth boundary. Rollback assets and hashes are recorded; an actual production rollback was not performed merely to test recovery.

For another release, create a new immutable version and fresh configuration from qualified live baselines. Do not blindly reuse this version-pinned helper/configuration or its original server baseline. Review pending systemd changes separately before deciding whether to reload units.
