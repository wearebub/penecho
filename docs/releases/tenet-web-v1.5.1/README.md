# Tenet Whiteboard hosted runtime 1.5.1

Installed and hash-qualified at `2026-09-10T19:49:13.603Z`.

- Immutable tag: `tenet-web-v1.5.1`
- Source: `d0482e4d60f6c1d31ae0261e677175641c2a97cf`
- Workflow: https://github.com/wearebub/penecho/actions/runs/34522346485
- Release: https://github.com/wearebub/penecho/releases/tag/tenet-web-v1.5.1
- Native pairing: `tenet-ipad-v1.4.0-build.30`; no new native binary.
- Archive SHA-256: `854194cf3ad0ef8daa8669c18c6ee78d5e3b3af493de674fc20a4ca53fbd7869`
- Manifest SHA-256: `b4897a20f222d896a6d18e5034ccaf02ea239f381f2fbc6bab5038a2b2e9ac5c`
- Changed CSS SHA-256: `657965fb7b123f81ef18752649af6b7b0979dfa9563591398492a3a92f89a957`
- Backup: `/opt/tenet-demo/backups/whiteboard-1.5.1-d0482e4`

## Root cause, decision, and preserved behavior

The 44px resize hit targets overlapped the AI draft Move button. Their overlay
was stacked at 42, above the object controls at 4, so the resize target could
receive the initial pointer instead of Move. The fix lowers resize controls to
the interaction-layer level, below the object buttons. Explicit native drag
selectors also preserve touch-action:none against the broad iPad button rule.

A gesture-system rewrite and globally disabling touch navigation were rejected:
the hit-target conflict occurs before the existing movement transaction begins.
AI behavior, Gateway policies, authentication, notebooks, ink renderers, and
native voice behavior are intentionally unchanged.

## Qualification

- Full local check: 1,061 total, 1,058 passed, zero failed, three skipped.
- Added three regression checks for stacking, drag touch policy, and navigation.
- Required Node 22 and Node 24 release CI passed.
- Production-style browser fixture: the same center point hit Resize top edge
  before the change and Move AI draft afterward. The native-class drag control's
  computed touch-action changed from manipulation to none.
- Actual isolated Whiteboard UI: an inserted object's toolbar moved 80px right
  and 60px down without changing dimensions. Bottom-right resizing still worked
  while its opposite corner stayed fixed.
- These are browser/fixture checks, not physical iPad finger or Pencil proof.
- Downloaded release hashes matched GitHub asset digests and manifest identity.
- All 29 prior runtime files matched the previous installed receipt before
  replacement. Only the usability CSS has a changed runtime hash.
- Seven public assets on each of ports 3888 and 3889 matched release hashes,
  returned HTTP 200, and retained Cache-Control:no-store. Both public district
  and Spanish endpoints retained unauthenticated HTTP 302 redirects.
- Demo host PID changed from 70836 to 71732. Auth PID 60559 and Caddy PID 54100
  stayed active and unchanged. Demo policy was restored byte-for-byte and the
  package lockfile was unchanged.
- Host restart rotates internal demo Gateway keys and resets ephemeral demo
  state. No notebook data or dependency changes were made.
- The pre-existing systemd unit/drop-in warning remained; no daemon-reload or
  unrelated service configuration change was performed.

## Audio controls

Voice needs native version 1.4.0 (30). The hosted client intentionally does not
show Talk to Tenet when the native getVoiceCapabilities method is unavailable.
That build's compile, signed archive, upload, and immutable-release workflow
completed successfully. The user's installed build and Apple's tester-side
availability were not independently confirmed in this release task.

On a compatible build, Talk to Tenet opens the voice question dialog and its
optional Read Tenet's reply aloud checkbox. This hotfix does not change the
audio bridge or bypass microphone, language, or permission requirements.

## Guarded rollback

After checking the current maintenance/policy context:

```sh
sudo node /opt/tenet-demo/backups/whiteboard-1.5.1-d0482e4/deploy-runtime.mjs rollback
```

The helper refuses to overwrite newer runtime changes, restores the exact
previous 1.5.0 files and recorded policy, restarts the demo host, and qualifies
the previous served hashes and authentication redirects. Do not run blindly
after subsequent releases or policy changes. The adjacent manifest, config,
helper, and deployment receipt preserve the release identity and rollback trail.
