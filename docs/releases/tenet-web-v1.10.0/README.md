# Tenet Whiteboard 1.10.0 installed release

- Status: hosted client installed at `2026-09-15T19:38:52.838Z`.
- Immutable source: `42a6bfeeea10a5b5bfcb7c7469fd19cc9a3cd029`.
- Release: https://github.com/wearebub/penecho/releases/tag/tenet-web-v1.10.0
- Release CI/archive: https://github.com/wearebub/penecho/actions/runs/35014525660
- Public viewer: https://github.com/wearebub/penecho/actions/runs/35014529015
- Unsigned iPad qualification: https://github.com/wearebub/penecho/actions/runs/35014498871

This is a hosted update loaded by the existing iPad application, paired with
`tenet-ipad-v1.8.0-build.46`. No new TestFlight binary was uploaded. Closing and
reopening the application loads the updated hosted client; installed-device
uptake and physical Pencil/voice acceptance remain separate checks.

## What students and teachers can use

Open Teacher view and select a saved whiteboard, or use that page's History action
in Pages & files. Playback now offers variable speed, a bounded checkpoint cache,
an activity graph with purple AI markers, and one combined event per recorded AI
interaction. Its inspector exposes the recorded question, origin, reply/outcome,
and available client request JSON/image. Missing legacy information stays explicit.

The public https://wearebub.github.io/penecho/ viewer was also published and its
source identity, JavaScript hash and stylesheet hash were checked after deployment.
It remains a synthetic/local-archive preview, not access to iPad saved notebooks,
an authenticated teacher dashboard, or a submission/LMS service.

## Qualification

Local canonical gate: 1,343 tests; 1,340 passed, zero failed, three existing skips.
GitHub Node 22 and Node 24 checks passed before immutable archival. The unsigned
iPad workflow and public viewer workflow also completed successfully.

Actual browser qualification exercised sample playback, combined AI inspection,
real canvas creation/request/save/reload, persisted exact input inspection, and
portrait layout. The local provider was intentionally absent, so that actual
request correctly retained a failure outcome; successful replies were covered
by controlled integration tests, not a paid live-provider test. See
`docs/tenet-teacher-playback-release-1.10.0.md` for scope, limits and regression
details. The source bug fixes retained the security checks rather than weakening
them to satisfy tests.

## Installed identity

- Manifest SHA256:
  `a9b2373043a57a5335f78b9ef152033e6b38961deb8b057349888e36f618cd89`
- Runtime TAR SHA256:
  `2d63b856a327c788ab1357d065270bf1f02301e5fdfb361fff44297559c2c81c`
- Served `public/app.js` SHA256:
  `7422dbc7c5be077112b80e95027ef28d3cf2817e6dc18bd606e9978c37226edc`
- Served viewer SHA256:
  `6efdaa1676cfc4784accff478d5d8bfb6678a44cb85d99bb2916e8290af5022f`
- Served process CSS SHA256:
  `2a3566e8f1f5a221eee192fc7978622ac507cb85595b1defad8377b879ceab86`

All 38 runtime paths were qualified against the installed 1.9.0 receipt. Exactly
six client paths changed: both generated JavaScript bundles, process CSS, and the
AI runtime, document-history and process-viewer source files. Both listener ports
3888/3889 served the expected public hashes with `no-store`; both external district
and Spanish unauthenticated roots retained their 302 authentication redirects.
Policy bytes, production package lock and service PIDs stayed unchanged. No server,
Gateway, authentication service, dependency or native binary was replaced/restarted.

The adjacent `deployment-receipt.json` contains the installed file identities and
checks. The immutable archive includes unchanged Whiteboard server files, so its
general-purpose publication metadata conservatively describes a restart. This
installation instead proves the exact six-file client-only delta and preserves
every running service PID.

## Repeatable promotion and rollback

The staging/backup directory contains the deployment script, qualified manifest,
configuration, complete previous/next runtime files and receipt:

`/opt/tenet-demo/backups/whiteboard-1.10.0-42a6bfe/`

Local qualification inputs and downloaded immutable artifacts are under:
`%TEMP%/tenet-whiteboard-1.10.0/`.

For the next release, use a new version/staging directory, the current installed
receipt as baseline, an exact reviewed changed-path allowlist and fresh immutable
artifact hashes. The deployment must reject live drift and prepare its backup
before installation. Never reuse this configuration for different source bytes.

Runtime rollback restores 1.9.0 code, not student notebook data. Exact baseline
audit found load/resave preserves valid new history assets inside existing limits,
but the old viewer can mistake AI input crops for page checkpoints. Prefer a
forward fix: data compatibility is not complete teacher-experience compatibility.
Do not claim PDF/PNG or these runtime backups protect local notebook history.

An explicitly authorized code-only rollback uses the saved script:

```sh
sudo node /opt/tenet-demo/backups/whiteboard-1.10.0-42a6bfe/deploy-runtime.mjs rollback
```

## Documentation change rationale

This follow-up records installation evidence, publication boundaries and the
rollback limitation. It rejects treating CI, an unsigned compile or a public
sample as installed-iPad proof. It changes documentation only; deployed source
remains the immutable `42a6bfe` commit, not this follow-up commit.
