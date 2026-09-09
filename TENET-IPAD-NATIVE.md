# Tenet Whiteboard native iPad application

## Deliverable

This directory contains an iPad-only Capacitor application for Tenet Whiteboard.
It is not a PWA wrapper and it does not ask students to enter a server URL. The
native target has bundle id `ai.truemade.tenet.whiteboard` and uses first-party
Swift code for authentication, Keychain persistence, managed configuration, and
PencilKit.

The web canvas remains the document model. PenEcho object semantics, selection,
agent context, and Gateway request handling remain intact. PencilKit augments the
canvas with a native full-screen handwriting studio and imports the result as an
ephemeral PNG.

## Runtime boundary

The iPad runs the Capacitor shell, WKWebView canvas, PencilKit, and Keychain. It
does not host Node.js, LiteLLM, the Tenet Gateway, or model credentials. Those
remain on the private VM so student rules and audit behavior stay centrally
controlled.

## Student authentication

1. The native plugin creates a PKCE verifier and opens
   `ASWebAuthenticationSession` against the governed host.
2. The existing Google oauth2-proxy login establishes access identity in the
   system authentication window.
3. The loopback-only native auth broker receives the verified edge email and
   returns a 90-second, one-use code to the app callback scheme.
4. The plugin exchanges the code plus verifier for an opaque eight-hour token.
5. Only Swift receives that token. It is stored in iOS Keychain with
   `AfterFirstUnlockThisDeviceOnly` and installed as an HttpOnly, Secure,
   host-bound WKWebView cookie.

The token response contains no email and JavaScript never receives the token.
Broker restarts invalidate all native sessions. Google access identity does not
grant teacher or administrator authority.

## Student rules and eventual class-level policy

The current private MVP maps the managed `studentRuleProfile` to one of two
closed governed routes:

- `district`: student safety baseline plus Socratic guidance
- `spanish`: student safety baseline plus Spanish immersion and Socratic guidance

MDM can select a profile but cannot provide rule text, arbitrary URLs, developer
keys, bypass flags, or staff roles. Unknown managed values block launch.

This profile selector is a bootstrap seam, not the final policy source. The
intended production chain is:

`Google/Clever/ClassLink student identity -> Tenet control plane -> current class memberships and class rules -> signed Gateway actor/policy context -> Gateway enforcement`

The Tenet rule server remains authoritative. The iPad may cache display state,
but absence, expiry, mismatch, or failed rule resolution must block governed AI
requests rather than falling back to local policy.

## Managed app configuration

Example MDM dictionary:

```xml
<dict>
  <key>requireManagedConfiguration</key>
  <true/>
  <key>studentRuleProfile</key>
  <string>district</string>
  <key>pencilKitEnabled</key>
  <true/>
  <key>fingerDrawingEnabled</key>
  <false/>
</dict>
```

`fingerDrawingEnabled=false` makes PencilKit pencil-only so a finger can pan.
The privacy manifest declares the managed-configuration UserDefaults access
reason and declares no tracking or collected data for the native plugin.

## Prepare the Xcode project

On Windows or macOS:

```powershell
npm ci
npm run mobile:deps
npm run mobile:ios:prepare
```

This creates the ignored native project at
`tools/mobile/ios/App/App.xcworkspace`. Capacitor platform output remains
generated rather than becoming a second source of truth.

## Compile and sign

Compilation, Simulator/device execution, archive signing, and `.ipa` export
require macOS with Xcode. On that Mac:

```bash
npm ci
npm run mobile:deps
npm run mobile:ios:prepare
APPLE_TEAM_ID=... \
IOS_PROVISIONING_PROFILE_SPECIFIER=... \
npm run mobile:ipa
```

The Apple team must own the `ai.truemade.tenet.whiteboard` identifier. Do not
commit signing identities, provisioning profiles, OAuth secrets, or exported
student sessions.

## TestFlight signing and release runbook

The first Apple provisioning setup was completed on September 9, 2026. These
identifiers are safe to record; none of the private key material is committed:

- GitHub repository: `wearebub/penecho`
- release branch: `codex/tenet-ipad`
- Apple team ID: `TFJBB5HWMJ`
- bundle ID: `ai.truemade.tenet.whiteboard`
- App Store Connect Apple ID: `6810373797`
- App Store Connect issuer ID: `410fbb18-7ef9-4e82-bb62-bca62590ff1a`
- TestFlight CI key ID: `N54B6AMD2X`, role `Developer`
- Apple Distribution certificate resource ID: `YU6F647GHR`
- certificate serial: `0E1CE9C02A91750240117461BD50BF47`
- certificate SHA-256 fingerprint: `7A:8B:3A:AD:9B:26:F5:E1:D7:5B:AA:93:BE:D3:12:B9:8D:E2:C2:8C:5F:2F:14:89:62:94:F9:CF:82:C6:1A:21`
- provisioning profile resource ID: `2XF5N2MYFH`
- provisioning profile UUID: `6a60ef30-189e-4e9f-bd39-3d7397c15051`
- provisioning profile name: `Tenet Whiteboard App Store`
- certificate and profile expiration: September 9, 2027

Private local signing material lives outside the repository at
`%USERPROFILE%\.tenet\apple\tenet-whiteboard`. Never copy that directory into
the repository, an issue, an Actions artifact, or a support ticket.

The `ios-signing` GitHub environment must contain exactly these workflow
secrets:

- `APPLE_TEAM_ID`
- `IOS_SIGNING_IDENTITY`
- `IOS_DISTRIBUTION_CERTIFICATE_P12_BASE64`
- `IOS_DISTRIBUTION_CERTIFICATE_PASSWORD`
- `IOS_PROVISIONING_PROFILE_BASE64`
- `APPLE_API_KEY_P8_BASE64`
- `APPLE_API_KEY_ID`
- `APPLE_API_ISSUER`

The persistent App Store Connect key is intentionally limited to the
`Developer` role. It can upload a signed build to TestFlight but cannot create
certificates or profiles. During the first setup, a separate Admin key named
`Tenet Provisioning Bootstrap` was created, used locally through Apple's
official provisioning API, and revoked immediately. Its key ID was
`87QKT65AX7`; it was never stored in GitHub. Repeat that temporary-key pattern
only when the certificate/profile must be rotated. Do not widen the persistent
CI key to Admin.

For an ordinary TestFlight build while the recorded certificate and profile
remain active, no Apple portal work is required. Dispatch the existing workflow:

```powershell
gh workflow run ios-release.yml `
  --repo wearebub/penecho `
  --ref codex/tenet-ipad `
  -f build_signed_ipa=true `
  -f upload_testflight=true
```

Then follow the run without exposing any secret values:

```powershell
gh run list --repo wearebub/penecho --workflow ios-release.yml --limit 1
gh run watch <run-id> --repo wearebub/penecho --exit-status
```

The workflow uses `npm ci` for both lockfiles, compiles the Simulator target,
imports the encrypted distribution identity and profile into a temporary macOS
keychain, archives the device app, verifies its signature, stores the IPA as a
GitHub artifact, and uploads that IPA to TestFlight with the Developer key.

First-time setup or annual rotation follows this order:

1. Confirm the Apple Developer membership and App Store Connect access are active.
2. Register the explicit bundle ID and create the App Store Connect app record.
3. Generate a local RSA private key and CSR outside the repository.
4. Create an Apple Distribution certificate from that CSR.
5. Create an `IOS_APP_STORE` profile for the bundle and exact certificate.
6. Export the certificate and private key as a password-protected PKCS#12 file.
7. Store only Base64 credential payloads and identifiers in the encrypted `ios-signing` environment.
8. Revoke any temporary Admin provisioning key and retain only the Developer upload key.
9. Run the signed workflow and confirm both the GitHub IPA artifact and TestFlight processing result.

Known setup pitfalls:

- Do not pass `PROVISIONING_PROFILE_SPECIFIER` as a global `xcodebuild`
  command-line setting. Xcode applies it to every workspace target, including
  CocoaPods frameworks that cannot use provisioning profiles. The mobile
  generator scopes manual signing to the generated `App` target instead.
- A Developer-role App Store Connect key returns `403 FORBIDDEN_ERROR` when it
  attempts certificate creation. Use a temporary Admin key locally and revoke
  it instead of broadening the persistent CI key.
- Chrome file upload requires the ChatGPT browser extension's file-URL access.
  The official provisioning API avoids that browser-only dependency.
- The profile list endpoint does not support a name filter. List profiles and
  compare `attributes.name` locally before creating one, or Apple's endpoint
  may return an unhelpful server error.
- The generated native `tools/mobile/ios` directory is ignored and is not a
  source of truth. Always regenerate it through `mobile:ios:prepare`.
- Use `npm ci`, not `npm install`; npm 11 rewrites peer annotations in the root
  lockfile even when dependency versions do not change.

## Intentionally deferred

- Clever and ClassLink authentication adapters can terminate at the same
  one-time native exchange after the control plane verifies the student.
- Full PencilKit replacement of the web canvas is deferred because flattening
  PenEcho objects into strokes would regress selection, editing, and AI context.
- Offline AI and on-device Gateway hosting are excluded because they would
  decentralize policy, secrets, and audit state.

## App Store SDK acceptance gate

Apple validates the SDK embedded in an uploaded archive independently of whether
the project compiles and signs successfully. On 2026-09-09, App Store Connect
rejected build 10 after a successful archive because the `macos-15` GitHub runner
selected Xcode 16.4 and the iOS 18.5 SDK; Apple required the iOS 26 SDK or later.

The release workflow therefore uses GitHub's `macos-26` runner for both the
unsigned simulator build and signed distribution build. That runner currently
selects Xcode 26 by default. Keep the two jobs on the same runner generation so
the unsigned qualification exercises the same SDK family used for the archive.

When Apple advances its minimum accepted SDK, update the runner only after
confirming the replacement image and installed Xcode versions in the official
`actions/runner-images` inventory. A green archive and signature check do not
prove App Store acceptance; the `Upload to TestFlight` step must also pass.

## Initial TestFlight activation receipt

The first accepted internal build was activated on 2026-09-09 with this
non-secret identity chain:

- Source commit: `ba3d7b0f5f1441e5631fb551e9a95b816177645c`
- GitHub Actions run: `34398479150`
- Marketing version and build: `1.2.0 (12)`
- App Store Connect app ID: `6810373797`
- Internal group: `Tenet Internal Testers`
- Internal group ID: `9d08361e-a3ac-46cc-9281-27e1584182e4`
- Initial tester: `caleb@truemadeai.com`
- Automatic distribution: enabled

The workflow derives the Apple build number from the GitHub workflow run number;
do not pass or invent a separate build-number input. Dispatch
`ios-release.yml` on `codex/tenet-ipad` with `upload_testflight=true`. A normal
push also starts the unsigned qualification job, so cancel that redundant run if
it is holding the iOS concurrency slot ahead of an explicitly dispatched signed
release.

After `Upload to TestFlight` succeeds, wait for App Store Connect processing,
then confirm the build appears under the internal group and the tester row shows
access. The initial build processed in roughly two minutes. App Store Connect
showed the build-level status `Ready to Submit` while the internal tester row
already showed `Installed 1.2.0 (12)`; `Ready to Submit` is therefore not a
blocker for this internal-test path. It applies to further beta submission work.

No external testing group, Beta App Review submission, or public App Store
release was created during this activation. Those remain separate release gates.
