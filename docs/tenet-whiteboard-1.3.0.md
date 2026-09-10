# Tenet Whiteboard 1.3.0

## Student-facing changes

- Pencil taps on the top bars pass through the native ink overlay to the web
  controls. Header/toolbar sizing and scroll changes update the exclusion geometry.
- Recent work is removed in Tenet mode, including its left-edge opening gesture.
  Pages & files, document titles, saving, and the right-side tutor remain.
- Insert creates rectangles, squares, circles, triangles, lines, arrows, and
  first-quadrant (0 to 10) or four-quadrant (-5 to 5) coordinate graphs locally.
  Students can choose outline/axis color, then move, resize, and delete the
  inserted image with the existing Hand controls.
- Pen settings offers a large width slider and Fine, Regular, Bold, and Heavy
  presets. Changes affect new strokes, not existing handwriting.
- Finger / regular stylus and Pencil-only modes are student-selectable. The
  preference stays on the device. A basic capacitive stylus supplies touch input,
  not Apple Pencil pressure or tilt. Hand remains available for navigation.
- The native default permits finger drawing when the managed key is absent.
  Explicit false or malformed managed values still refuse it. The student's
  preference can narrow input, never override a managed native refusal.

## Why these changes

The native overlay already supported exclusion rectangles, but its list omitted
the top bars. Fixing that boundary preserves real Pencil events; synthesized
clicks were rejected. No viewport coordinate transformation changed.

The redundant navigator is disabled at its owning logic, rather than merely
hidden with CSS. Its title/save machinery and non-Tenet behavior remain intact.

Shapes deliberately use existing image objects instead of introducing another
document format or flattening native ink. They are resizable images, not editable
vector paths or function-plotting widgets. Insertion itself makes no AI request.
Normal tutor capture may subsequently include the page's inserted objects.

Authentication, Gateway routing, prompts, student rules, credentials, native ink
archive format, and notebook persistence are intentionally unchanged. No
dependency was added. Lockfile edits only record the application version.

## Release and qualification

This release requires both a new signed iPad binary and a hosted-client update.
The web interface alone cannot change the old binary's default finger policy.

Use the existing full Node 22/24 CI gate, macOS simulator compile, signed IPA
verification, and explicit TestFlight upload. Native build numbers come from the
producing workflow; never reuse or decrement them. Publish immutable native and
hosted 1.3.0 release records with their exact source and artifact hashes.

Deployment must use the published client-only archive, compare the previous
per-file receipt, back up affected paths, and leave services, secrets, Gateway,
authentication, and saved notebooks unchanged. See tenet-whiteboard-releases.md.

Real-iPad acceptance is separate from automated checks: tap top controls with
Pencil, draw with finger and a capacitive stylus, change width, insert and resize
both graph types, save/reopen, switch engines, undo/redo, export PDF, and check the
tutor with new ink. Simulator compilation and browser fixtures cannot establish
physical Pencil hit testing, latency, or palm-rejection quality.
