# Tenet Whiteboard iPad 1.7.0 (40)

Status: signed IPA verified, TestFlight upload succeeded, immutable release
published, downloaded assets and annotated source tag verified.

- Source: `e7fdf111681be974fa54f047d233b83a32f2b510`.
- Bundle: `ai.truemade.tenet.whiteboard`.
- Release: https://github.com/wearebub/penecho/releases/tag/tenet-ipad-v1.7.0-build.40
- Workflow: https://github.com/wearebub/penecho/actions/runs/34539845278
- Annotated tag: `878876d816fc10bff3f0f2befac078ac6b58f62e`.
- IPA SHA-256: `09a52a571f27197af74361951f33b368727296c8b54a82316c9a2470c07da5e6`.
- Source ZIP SHA-256: `0ae0de53bcb26d71e78efd3b9a9b26dea1f7a213aef6fdaef87770e0131faa7f`.
- Manifest SHA-256: `ecd8edd6e690cc826cc79a1aa9336dc2ecaa9b2bdef8bfa52496f5ddd72c5658`.

## Upload evidence

At `2026-09-10T23:02:28Z`, the signed job's `Upload to TestFlight` step reported
`UPLOAD SUCCEEDED with no errors`.
Apple delivery UUID: `4c2f3f7e-5170-43cc-9737-0aab083a89ad`.
The release manifest records `testFlightUpload: true`.

Full Node 22/24 CI, Simulator compilation, mobile package checks, signed
archive creation, deep signature verification, upload and immutable archival
all passed. Local full check: 1,155 passes, zero failures, three existing skips.
Downloaded assets match GitHub digests, manifest hashes and the exact tagged
source. No signing credentials are stored in this record.

Apple post-upload processing and physical-device acceptance were not confirmed
in this run. The App Store Connect browser session had expired; upload used
the existing authorized CI API credentials. This is a TestFlight testing
release, not a public App Store submission or approval.

## Hosted pairing and changes

Hosted `tenet-web-v1.7.0` from the same source commit was installed before
this native workflow was dispatched. Its separate receipt includes all 31
runtime files, live served hashes, unchanged authentication services and the
successful synthetic blank-question check through the deployed Gateway.

See `../../tenet-whiteboard-1.7.md` for root causes, rejected alternatives and
unchanged boundaries. This build adds word-pause recognition; the hosted layer
adds nonblocking startup, text-only blank questions, exact selection processing
visuals, stable circle capture, control hit handling, graphic entry points and
consistent minimum-hint policy.

## Device acceptance checklist

1. Update to 1.7.0 (40) in TestFlight when Apple makes it available, then reopen.
2. With permissions already granted, tap the microphone: recording starts
   without waiting for an image preview.
3. Ask a short question, then stop adding words for 1.5 seconds. Finalization
   should submit once; repeated/punctuation-only transcripts must not delay it.
4. Ask on a blank page: receive a text-only reply, not an image-loading error.
5. Circle existing work and Talk: only its polygon is submitted and highlighted.
6. Use finger and Pencil on Submit, Cancel, Circle and toolbar controls without
   drawing behind them. Check native line thickness and ordinary scrolling.
7. Cancel, change page or background during recording: no stale question sends.
8. Confirm schoolwork questions receive the smallest hint rather than a worked
   solution. Policy instructions are not a guarantee of perfect model compliance.

Recognition finalization can add latency after the 1.5-second word pause. If
no final transcript arrives within the bounded wait, the app offers manual
review instead of silently submitting incomplete speech.

## Rollback

Prior native release: `tenet-ipad-v1.6.0-build.36`. Use that previous TestFlight
build only if Apple still makes it available, coordinating with the hosted
1.7 rollback receipt. Otherwise restore the desired source into a new release
with increasing build identity. Do not overwrite immutable assets, move tags,
decrement build numbers or treat an archived IPA as a generic sideload package.
