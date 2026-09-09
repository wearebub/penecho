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

## Intentionally deferred

- Clever and ClassLink authentication adapters can terminate at the same
  one-time native exchange after the control plane verifies the student.
- Full PencilKit replacement of the web canvas is deferred because flattening
  PenEcho objects into strokes would regress selection, editing, and AI context.
- Offline AI and on-device Gateway hosting are excluded because they would
  decentralize policy, secrets, and audit state.
