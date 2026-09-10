# Tenet Whiteboard iPad 1.6.0 (36)

- Tag: `tenet-ipad-v1.6.0-build.36`
- Source: `ee41e1e2c096afbb982206f68dd64289bc215344`
- Bundle: `ai.truemade.tenet.whiteboard`
- Workflow: https://github.com/wearebub/penecho/actions/runs/34532284158
- Release: https://github.com/wearebub/penecho/releases/tag/tenet-ipad-v1.6.0-build.36
- IPA SHA-256: `c23039058bf5469d3577094e0fc23ce3f0a0e7b38cc8f4ce4906e8d2a491f537`
- Source ZIP SHA-256: `62164bd211610acd33b14c9b9aeef3bfc857a59992d51f8f846c72f58277ef11`
- Manifest SHA-256: `2c2f1156e2225efddcc9af64d878e7ff385dd222e10a167cb2866336f8b7cfa0`

Both Node CI versions, Simulator compilation, signed IPA construction,
signature verification, TestFlight upload and immutable release archival passed.
Downloaded IPA, source ZIP, checksum list and manifest were hash-checked against
GitHub's asset digests. Adjacent JSON files preserve that evidence.

Upload success is not proof that Apple has finished processing the build or
that an iPad has installed it. Physical acceptance remains required.

## Why this release exists

Native palette notifications could overwrite the web thickness choice. The
native surface's UI exclusions previously affected touches but did not visually
hide ink. Speech selected a default voice even when better local voices were
installed. This build fixes those native behaviors and adds bounded editable
stroke-region movement and microphone-level silence detection for voice send.

Native visual clipping subtracts overlapping UI rectangles without even-odd
holes, has a bounded work limit, and never modifies PKDrawing. Voice auto-send
requires 1.5 seconds of detected silence, settled nonempty text, current
authorization/session/page and the explicit native capability. Background noise
may delay sending and recognition finalization can add latency. Cancel and manual
review remain available. Enhanced/premium speech depends on installed voices.

Rasterizing strokes, uploading audio, using transcript cadence as silence, and
rewriting the entire gesture system were rejected. Auth, managed policy,
notebook schema, Gateway rule text and dependencies remain unchanged.

## Hosted pairing and rollback

The application loads its canvas from the hosted Whiteboard. Pair this binary
with `tenet-web-v1.6.0`, which also contains the final Pages-dock exclusion
selector correction from source `9bc6539dbcaafb3fae4e7de8c462cbd1e5ca6cb8`.
The separate source identities are intentional and recorded in both releases.

Release attempt 34 was cancelled before native publication to include visual
masking. Redundant unsigned push runs were cancelled; the signed run above is
the release authority. No existing tag or artifact was replaced.

For native rollback, use a previous available TestFlight build or rebuild the
previous tagged source with a new, higher build number through the signed
workflow. Do not overwrite a tag or assume an App Store downgrade is automatic.
Hosted rollback uses the separate deployment receipt and guarded runtime helper.
