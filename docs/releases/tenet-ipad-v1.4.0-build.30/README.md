# Tenet Whiteboard iPad 1.4.0 (30)

Signed IPA compiled, verified, uploaded to TestFlight, and archived successfully.
Apple processing/internal-tester availability was not independently confirmed:
the App Store Connect browser session required sign-in. No public App Store
submission or release was performed.

- Immutable tag: `tenet-ipad-v1.4.0-build.30`
- Source: `93444b826be4446cfa05d786604f5fcc4251c80e`
- Bundle ID: `ai.truemade.tenet.whiteboard`
- Workflow: https://github.com/wearebub/penecho/actions/runs/34514447952
- Release: https://github.com/wearebub/penecho/releases/tag/tenet-ipad-v1.4.0-build.30
- IPA SHA-256: `fdbff5c18690abecf07c38270db9727f2ea7cd7b348ead1261508bc1adbb9f03`
- Hosted pairing: `tenet-web-v1.5.0`, source `92dc56666ad33d97d388e96b86b78181b4e7b6c0`
- Previous native release: `tenet-ipad-v1.3.0-build.25`

## Change and boundaries

Root cause: voice questions need native local transcription and explicit page
context without requiring handwritten input or a circle gesture. This binary
adds the Speech/AVFoundation bridge, local speech synthesis, bounded recording,
permission descriptions, and foreground/session/navigation cancellation.

Cloud transcription, always-on listening, and a separate AI endpoint were
rejected. District identity, Keychain session exchange, managed student rules,
PencilKit/web ink, and Gateway enforcement are unchanged. Audio stays native;
the hosted client sends only the reviewed transcript and disclosed visible-page
crop through the existing AI endpoint. Spoken replies are optional.

## Qualification

- Node 22 and Node 24 required CI passed for the native source.
- macOS 26 simulator compilation passed.
- Signed distribution archive/export and strict codesign verification passed.
- TestFlight upload and immutable-release archive jobs passed.
- Native source-contract tests cover on-device gates, bounds, session authority,
  cancellation, permission races, observer teardown, and actual playback events.
- Final paired hosted source: 1,055 passed, zero failed, three skipped locally;
  both hosted Node CI jobs also passed.

Physical-device acceptance remains required: first permission grant and denial,
supported/unsupported languages, fast cancel/background, headphones unplugging,
microphone quality in classroom noise, and stopping spoken replies. Browser
simulation is not Apple Pencil, microphone, or physical-device proof.

## Rollback

Keep the immutable previous native tag and signed IPA. Existing testers can
select the older TestFlight build while Apple still offers it. A later distribution
rollback must rebuild the chosen immutable source under a new build/version;
never overwrite an existing tag or reuse an Apple build number.

Hosted rollback to `tenet-web-v1.4.0` removes the voice UI and leaves this binary's
audio bridge unused. Conversely, older native builds hide the new voice controls
because they do not implement the capabilities method.

Feature guide: `docs/tenet-ipad-voice.md`. Machine-readable signed-release identity
is retained in the adjacent `release.json`.
