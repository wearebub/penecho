# Tenet Whiteboard hosted runtime 1.5.0

Installed and hash-qualified on both district and Spanish demo endpoints at
`2026-09-10T18:40:24.368Z`.

- Immutable tag: `tenet-web-v1.5.0`
- Source: `92dc56666ad33d97d388e96b86b78181b4e7b6c0`
- Workflow: https://github.com/wearebub/penecho/actions/runs/34515353730
- Release: https://github.com/wearebub/penecho/releases/tag/tenet-web-v1.5.0
- Native pairing: `tenet-ipad-v1.4.0-build.30`
- Runtime archive SHA-256: `a953ab3459285160e3fadf8e3ad02b9acef638ab5d664d98f2d64b8035d26322`
- Release manifest SHA-256: `a62eb78f574a5dc7150f1e6f2371d2bfeefbd83b0c1f9aef3c8688dc059f4ac7`
- Served `public/app.js` SHA-256: `dc03b771e47ac1334e67f3a4767fa3613ab1095f7e82ee8224c176fb54a14938`
- VM: `tenet-gateway-demo`, project `tenet-connect-demo`, zone `us-central1-a`
- Receipt: `/opt/tenet-demo/backups/whiteboard-1.5.0-92dc566/deployment-receipt.json`

## Why this release exists

Voice questions must not require circling first. The iPad-only Talk panel shows
the transcript and included visible-page preview, supports typing fallback, and
offers opt-in spoken replies without removing the normal canvas answer.

An integration check also found that ordinary lasso placement moves replies
outside its selected rectangle. Reusing that behavior for a whole-page question
would put answers off-screen. A validated manual `visible-page` question scope
now identifies the spoken question as the attention target and keeps text,
picture, and graph replies in the viewport.

Rejected cloud audio, a new ungoverned AI endpoint, and changing every lasso's
placement rules. Intentionally unchanged: normal circle help, destructive-tool
coordinates, Gateway/student policy enforcement, both ink renderers, and native
authentication. The runtime update has 29 qualified files; no dependencies,
notebooks, or package lockfile were changed on the host.

## Qualification and deployment effects

- Local final regression: 1,058 total, 1,055 passed, zero failed, three skipped.
- Required Node 22/24 release CI and immutable archive jobs passed.
- Downloaded manifest/archive hashes matched GitHub asset digests.
- Prior live files matched the 1.4.0 receipt before replacement.
- All seven public assets matched release hashes on ports 3888 and 3889, returned
  HTTP 200, and retained `Cache-Control: no-store`.
- Both public unauthenticated endpoints continued returning HTTP 302.
- Demo host PID changed from 70061 to 70836; auth PID 60559 and Caddy PID 54100
  remained unchanged and active.
- Demo policy was restored byte-for-byte after readiness. The host restart
  rotated internal demo Gateway keys and reset ephemeral synthetic demo state.
- The previously observed systemd unit/drop-in warning remained. No daemon-reload
  or unrelated service configuration change was performed.
- Real on-device microphone/locale/permission behavior remains for iPad acceptance.
  The attempted synthetic browser-native preview was blocked by the tool policy;
  it is not counted as verification. No browser audio or physical-device success
  is claimed from the VM tests or hosted compiler.

## Guarded rollback

The backup contains the exact prior files, policy, ownership metadata, manifest,
and receipt. After confirming the current demo policy/maintenance context, run:

```sh
sudo node /opt/tenet-demo/backups/whiteboard-1.5.0-92dc566/deploy-runtime.mjs rollback
```

The helper refuses to overwrite newer file changes. It restores the 1.4.0 files,
removes only files introduced by this release, restarts the demo host, restores
the recorded demo policy, and qualifies the previous served hashes and auth
redirects. Do not run it blindly after a later deployment or policy change.

The adjacent config, release manifest, deployment helper, and installed receipt
are the audit trail. This hosted rollback does not change the TestFlight binary.
