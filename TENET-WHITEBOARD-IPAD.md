# Tenet Whiteboard for iPad

## Status

Tenet Whiteboard is a private hosted MVP built from the PenEcho fork. It is an
installable, online-only iPad web application. It is not an App Store binary and
it is not a district production release.

Hosted routes:

- Governed district canvas: `https://district.connect.truemadeai.com`
- Governed Spanish canvas: `https://spanish.connect.truemadeai.com`
- Private launch page: `https://connect.truemadeai.com`
- PenEcho comparison canvas: `https://plain.connect.truemadeai.com`

The comparison route intentionally keeps PenEcho branding and does not enable
Tenet mode.

## Identity boundary

The private MVP uses Google OAuth at the reverse-proxy edge. The proxy admits
only configured email addresses or domains and establishes the browser session
before Caddy serves the application. The browser never receives the Gateway
credential.

This proves access identity only. An allowed Google email does not establish a
Tenet student, teacher, or administrator role. The whiteboard therefore shows
the bounded label `Student rules active` and does not render or persist the email.
The governed routes apply the closed student-safety and instructional guardrail catalog on every AI turn. Staff and administrator actions are outside this MVP. District-grade role authorization remains a separate integration.

## Install on iPad

1. Open a governed route in Safari.
2. Complete the Google sign-in flow.
3. Tap Share.
4. Tap Add to Home Screen.
5. Launch Tenet Whiteboard from the new home-screen icon.

The application requires a network connection. It intentionally has no service
worker or offline cache because AI requests and governance decisions must pass
through the live authenticated Gateway.

## White-label behavior

The white-label layer runs only when the server emits `tenetMode: true`. It:

- names the installed application and browser surface `Tenet Whiteboard`;
- presents the embedded assistant as `Tenet Tutor`;
- adds Tenet iPad icons, theme metadata, safe-area layout, and install guidance;
- keeps the existing Apple Pencil and touch behavior from the Tenet fork;
- retains an AGPL attribution to the PenEcho canvas foundation.

Internal PenEcho protocol names, storage keys, package identity, and the plain
comparison route are intentionally unchanged. Renaming those internals would add
migration risk without improving the student-facing white label.

## Build and operate

Use the locked dependency graph:

```powershell
npm ci
npm run build:client
```

Do not use a plain `npm install` in this fork. npm 11 rewrites peer annotations
in `package-lock.json` even when dependency versions have not changed.

The hosted VM remains a private sales and product-validation environment. A
district launch still requires a reviewed identity/role contract, production
operations, device-policy validation, and an authorized release decision.
