# Tenet Whiteboard 1.11.0: portable saved-work submissions

Release date: 2026-09-15. Release source: `f973ea707462e4b9f5ef7120b8d8dab63e6e6ff2`.

## Release status

- Native: **1.11.0 (51)**, signed and uploaded successfully. Apple build `04744123-f8d2-49e8-bbb3-03d8a5b16e98` is `VALID`, unexpired, and `IN_BETA_TESTING` internally. Apple's external state is `READY_FOR_BETA_SUBMISSION`, not an external beta or public App Store release. Automatic notification is enabled. The API refused a direct build-to-beta-groups read with 403, so group membership was not independently confirmed by that request. Installation on the user's physical iPad has not been verified.
- Native immutable archive: https://github.com/wearebub/penecho/releases/tag/tenet-ipad-v1.11.0-build.51
- Native workflow: https://github.com/wearebub/penecho/actions/runs/35025319723
- Hosted immutable archive: https://github.com/wearebub/penecho/releases/tag/tenet-web-v1.11.0
- Hosted archive workflow: https://github.com/wearebub/penecho/actions/runs/35026323160
- Hosted client installed at `2026-09-15T21:37:06.344Z` on both district and Spanish demo surfaces. Forty managed runtime files match the manifest; ten paths changed, including two new modules. Public asset responses match the release hashes, and both unauthenticated entry points still return 302.
- Public teacher viewer: https://wearebub.github.io/penecho/ . Its deployed HTML, JavaScript, and CSS match this source release. Pages workflow: https://github.com/wearebub/penecho/actions/runs/35025322779 .

The canceled automatic-push iPad run `35025320369` was a duplicate of the explicitly dispatched signed release, not a failed qualification run.

## Student and teacher flow

1. Save the whiteboard, then open **Pages & files** and choose **Share work** on that saved page.
2. Share the `.tenet` file using the native iOS share sheet, or download it in a browser. The export represents that saved version, not subsequent unsaved canvas edits.
3. Optionally choose **Open report / PDF**, then **Prepare PDF** and **Share/save PDF** for a readable final-page and AI-use summary.
4. Attach the `.tenet` file and, if useful, the PDF to the assignment using the LMS's ordinary file-upload flow.
5. The teacher opens the public viewer, chooses **Open shared work**, and selects the downloaded `.tenet` file. Playback and recorded AI inputs/replies are read locally; opening the file does not upload its contents to Tenet or invoke AI.

The new native binary is required for the native file-sharing method. An older native client receives an explicit update-required message if it has no supported sharing fallback. The `.tenet` package is a review artifact, not an editable-notebook restore format.

## Why this design

**Root cause:** saved work and teacher-review history were tied to this device's local store. A screenshot or final PDF alone could not carry the sequence of work, AI questions, replies, and available input crops to another reviewer. The first UI integration also left share confirmations in a closed dialog and used a report bundle without the saved final-page preview. Those integration defects were corrected and covered by regressions.

**Considered and rejected:** GIF/video export loses inspectable request details and requires repeated rendered frames. Embedding the only copy of history in PDF metadata is not a reliable portable review interface. The chosen versioned, gzip-compressed `.tenet` container deduplicates exact asset bytes and preserves structured history. The PDF is a separate convenience report; its rasterized text is not searchable or selectable.

**Intentionally unchanged:** Gateway routing, authentication, district rules, AI prompts, student-rule enforcement, and existing capture/retention semantics. No automatic LMS submission, LTI integration, assignment authorization, hosted student-file service, permanent public student link, or authorship/cheating inference was added. Native edits are limited to safe file export and the shared export presentation lifecycle.

## Size and privacy boundaries

- A qualified saved-page sample exported to 116,930 bytes from 306,179 expanded manifest bytes, with five unique assets and eight history events. This is a measured example, not a promised compression ratio.
- Its final two-page A4 PDF was 250,859 bytes and included the saved page plus the recorded AI question/reply report.
- `.tenet` limits are 64 MiB compressed, 96 MiB expanded JSON, 64 MiB unique decoded assets, and 16 MiB per asset. Additional bounded counts, nesting, event, and preview limits are documented in `docs/tenet-portable-submissions.md`.
- Unsupported, malformed, oversized, or integrity-invalid files fail explicitly. History is not silently dropped to meet a size target.
- SHA-256 integrity checks are not signatures or evidence of student identity, authorship, or a server receipt. Legacy saves without history are labeled honestly; no events are fabricated.
- Exported files are not encrypted or revocable. Any recipient who possesses the file can read its included student work and AI history. Share only through the school's approved workflow. Raw microphone audio is not retained by this feature.

## Qualification evidence

- Final local canonical `npm.cmd run check`: **1,412 passed, zero failed, three existing skips** (1,415 total), with the optional real exported-file fixture enabled through `TENET_SUBMISSION_ARTIFACT`.
- Both Node 22 and Node 24 hosted CI matrices passed for the exact release source. The local external-artifact test intentionally skips when that machine-specific fixture is not provided; ordinary format round-trip regressions still run in CI.
- macOS Simulator compile, signed device build, immutable native archive, and TestFlight upload passed. Upload delivery UUID matches the Apple build ID above.
- Codec/history focused run: 94 passed. UI: 87 passed. Native contract/integration tests: 37 passed. New sharing/PDF tests: 17 passed. These overlap the canonical suite and are not additive totals; native contract tests alone are not device execution.
- Actual browser saved-page sharing, visible confirmation, selected-page report preparation, and PDF download were exercised. The actual `.tenet` artifact was decoded with the production codec in a fresh VM, with original asset hashes and AI crop bytes checked.
- The browser automation API did not support its file chooser's `setInputFiles` method. Therefore automated browser file-picker import was not claimed; file handling was covered in the UI harness and actual exported-file decode instead.
- The final downloaded PDF was parsed and both pages were rendered and visually inspected. No paid provider call or physical iPad share-sheet test was made during qualification.
- Hosted installation verified served hashes on ports 3888/3889, readiness, authentication redirects, and unchanged service process identities, package-lock hash, and policy. No service restart was needed.

## Artifact identities

| Artifact | SHA-256 |
| --- | --- |
| Signed IPA | `2cc253bd57f0415b58804fe6ecc8cb1f3171d32a3a0fc9fbc21cfd68746ee139` |
| Native source ZIP | `705844348659d236676548d2421de5651b8388116219f9f85fea88d1f993c2b1` |
| Native release manifest | `01c7abc940b5f60160e542245ec831894ab6d2d9f84272360dc5cb6d9ea3e4cc` |
| Hosted runtime TAR | `4119d82a779e29720043fdc5eefbd8a28247a5b9feb64abb438da505f79c63f3` |
| Hosted release manifest | `0470bc6b8742d2568e6733df276170a4b42a644ccb1fd844f76eef0137b0f9ae` |
| Served application JS | `cc66111f0e0ff0b3c68c75e827c5ae95d47692347a31f31304660293dd276bae` |
| Teacher viewer HTML | `5c44bb1b2d6a0a0ade36fb7cbfbb301ca069ecc3a0472163106652f74a385b74` |
| Teacher viewer JS | `e1342ddc5640db560d481e2d5e0f1211f0795597a8a61b2814a5fd8d8e5bf1b3` |
| Teacher viewer CSS | `0fa95035db1c8f3dd5a396b03bf2864992f2b63076b0c5c61dec51b99c9a38bc` |

## Rollback and outstanding acceptance

The machine-readable installed receipt is `docs/releases/tenet-whiteboard-1.11.0-deployment.json`. The protected VM backup is `/opt/tenet-demo/backups/whiteboard-1.11.0-f973ea7`; its baseline is hosted 1.10.0, source `42a6bfeeea10a5b5bfcb7c7469fd19cc9a3cd029`. The deployment tool, config, manifest, and runtime archive are retained together in its protected `rollback-tool` directory. The guarded `rollback` mode restores the backed-up runtime only if later drift checks permit it. Do not blindly overwrite a subsequent release, policy change, or unrelated server edit.

Native and hosted archives are immutable. Do not move their tags or replace assets. A native correction should receive a newer build rather than replacing build 51; native device delivery is independent of hosted rollback. The public teacher viewer is a separate Pages deployment and is not rolled back by the VM tool.

Remaining acceptance: update a physical iPad to 1.11.0 (51), share one saved whiteboard through the iOS sheet, and open that file on a separate teacher device. Confirm an ordinary LMS attachment/download preserves the file and that the intended recipients can access it. This release does not claim completed LMS API integration or installed-device acceptance.
