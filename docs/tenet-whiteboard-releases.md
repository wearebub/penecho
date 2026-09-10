# Tenet Whiteboard versioned releases

## Release identities

The iPad binary and hosted canvas have independent release identities. A signed app version alone cannot identify the JavaScript subsequently served to it.

| Surface | Convention | Initial archived release |
| --- | --- | --- |
| iPad | `tenet-ipad-v<marketing-version>-build.<build-number>` | [1.2.0 (18)](https://github.com/wearebub/penecho/releases/tag/tenet-ipad-v1.2.0-build.18) |
| Hosted client | `tenet-web-v<major>.<minor>.<patch>` | [1.2.1](https://github.com/wearebub/penecho/releases/tag/tenet-web-v1.2.1) |

Initial native source: `6c460b514c31c6e9281890f337dd49ab46f34c26`. Initial hosted source: `ae100f11c1eb45a6fa8dc31a73b57ceafe8df83b`.

Build 18 is a historical archive of the exact existing IPA, not a rebuild and not a retroactive claim that its source passed the new full-CI gate. Its original signed/upload workflow is [34417153252](https://github.com/wearebub/penecho/actions/runs/34417153252). The hosted 1.2.1 source passed [full CI 34419653878](https://github.com/wearebub/penecho/actions/runs/34419653878).

All current releases remain testing prereleases. Neither a GitHub release nor TestFlight upload means App Store approval or completed physical-device acceptance.

## What is preserved

- Annotated tag pointing to an exact source commit, never a moving branch.
- Exact signed IPA for native releases, or a client-only TAR for hosted releases.
- Explicit source ZIP from the tagged commit.
- `release.json` with source, build/workflow provenance, artifact hashes, and hosted path hashes.
- `SHA256SUMS` covering the payloads, source ZIP, and manifest.
- GitHub immutable releases: publishing freezes release assets and the associated tag. Do not disable immutability, overwrite assets, move tags, or delete releases to correct a mistake. Issue a new version.

Artifacts are GitHub Release assets, not only expiring Actions artifacts. This removes Actions retention as the archive lifetime, but does not replace an independent disaster-recovery backup or protect against deletion of the entire repository.

Repository visibility remains public. Publish only committed public source, the distribution IPA, client assets, and non-secret provenance. Never attach certificates/private keys, `.env`, signing exports, account data, student notebooks, or raw server backup directories.

## Future native releases

1. Commit the intended source and update the marketing version in `package.json` when appropriate. Build numbers continue using the monotonically increasing iOS workflow run number. Do not change the package version just to publish a hosted-client patch.
2. Dispatch `Tenet Whiteboard iOS` on the intended branch with signed build enabled. Enable `upload_testflight` only when uploading is intended.
3. Full Node 22/24 CI must succeed before simulator compilation; signing requires successful compilation. The archive job requires a successful signed release job and independently checks those job results.
4. The archive job downloads the exact signed artifact, reads the IPA's binary plist, matches bundle/version/build to source and workflow, and publishes the immutable tagged release. It has no signing secrets and cannot initiate another TestFlight upload.
5. Record Apple's processing result and real-device acceptance separately. If publication fails after TestFlight upload, recover archival from the same workflow artifact; do not rebuild and pretend it is the same binary.

Published releases are never replaced on a rerun. Existing tags must resolve to the same commit and assets must have identical digests; mismatches fail closed. Partial drafts are recoverable only with identical content. Keep original workflow artifacts until durable release publication succeeds.

## Future hosted releases

1. Choose a new hosted semantic version. Use patch for compatible fixes, minor for compatible features, and major for incompatible changes. Explicitly assess notebook/data-format compatibility.
2. Dispatch `Tenet Whiteboard web release` on the intended source branch, entering the version and a published native release tag. The workflow reruns full Node 22/24 CI for that source before publishing.
3. The TAR includes five public assets, `scripts/build-client.js`, and `src/client`. This is an overlay for the existing hosted installation, not a clean-server installer. Extend the explicit `WEB_PATHS` allowlist whenever a feature adds a required client asset; do not archive the live server directory.
4. Publishing is not deployment. A separate authorized deployment must verify the release checksum, compare the live baseline, back up affected paths, apply only the allowlist, and record the release tag, source commit, artifact hash, paired native release, and per-file receipt.

The initial hosted 1.2.1 archive preserves the previously deployed TAR byte for byte. Deployment occurred at `2026-09-10T00:08:03.316Z`. Its previous-state receipt is `/opt/tenet-demo/backups/whiteboard-20260909-ae100f1/deployment-receipt.json`; the [CI recovery record](tenet-ci-recovery-2026-09-09.md) records hashes and scope. That private server receipt is not uploaded wholesale.

## Rollback

1. Select the exact native and hosted release identities separately; never use a moving `latest` branch or assume matching version strings imply compatibility.
2. Verify downloaded artifacts against `SHA256SUMS` and the release manifest. Preserve current local notebooks before any rollback and assess whether older code can read the current saved-data format.
3. For hosted rollback, use the selected deployment receipt. Restore only recorded paths after their current hashes match the expected deployed version. Remove newly introduced files only when the receipt records no previous file and current identity still matches. Leave Gateway, authentication, credentials, and notebook data alone.
4. An archived App Store distribution IPA is not a general sideload installer. TestFlight rollback depends on Apple still making an older build available. For an App Store rollback, restore the selected source and ship it through Apple's signing/review process with a new build and, where required, marketing version. Do not reuse or decrement a published build number.

## Why this changes the release process

Root cause: source commits and temporary workflow artifacts were being treated as sufficient release records, leaving no durable binary archive or explicit native/hosted pairing. We rejected a single shared version, mutable tags, rebuilding historical IPAs, and turning archive publication into automatic production deployment. Authentication, Gateway rules, signing configuration, installed build 18, and saved notebook formats are intentionally unchanged.

Reference: [GitHub immutable releases](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository). Use `npm ci`, not bare `npm install`, for dependency installation.
