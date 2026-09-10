# Native ink welcome state and quick-ask placement

## Root causes

The studio empty-page predicate counted web tiles and placed objects but not
native ink. Native snapshots already notified the document UI; their content
was simply excluded from the predicate. Waiting only for serialized snapshots
would also leave the message over the first live Pencil stroke.

Quick ask is an absolutely positioned canvas control. Its upstream top offset
assumes the toolbar is the configured single/two-row height, while the native
engine controls can wrap and make the actual toolbar taller. The toolbar then
covers the quick-ask button rather than the button leaving the page itself.

## Changes

- Count native strokes regardless of the selected rendering engine.
- Treat a live/pending native ink stroke as content until its snapshot arrives.
- Refresh document UI on activity, accepted snapshots, restore, clear and undo.
- Ignore old-session activity and retain existing snapshot revision checks.
- Measure actual toolbar/header occlusion and update canvas-control offsets on
  resize, viewport scrolling, page restoration and layout transitions.
- Keep quick ask within the canvas, make its button 48 by 48 CSS pixels, and
  retain full idle visibility. Refresh native touch exclusions after placement.
- Disconnect the new observer/listeners on page teardown, retaining them only
  for back-forward-cache restoration. No polling or persistent storage added.
- Use the existing runtime stylesheet helper for measured CSS variables. The
  strict style security test remains unchanged; no inline-style exception added.

## Considered and rejected

A one-off DOM hide would not cover restored pages, engine switching or undo.
A larger hardcoded top offset would break again after rotation or toolbar
changes. Reusing measured height as the toolbar's own minimum height would
create layout feedback and prevent shrinking. A duplicate AI button would risk
divergent busy/cancel handling; the existing control and handlers are retained.

## Intentionally unchanged

No drawing-coordinate transforms, native Swift, archive format, AI prompts,
capture regions, auto/manual invocation semantics, authentication, Gateway
routing, student rules or saved-page data changes. The original quick-ask
handler still uses the existing capture, flush and cancellation paths.

## Qualification still required

Run focused native/UI regression checks and the normal release checks before
publishing. Test empty and native-only pages, first stroke, cancellation, lift
before serialization, undo/redo, clearing and reopening. Check the button after
native-control wrapping, portrait/landscape rotation, split view, zoom, an open
agent panel and Pencil taps. Real-device behavior is not established by source
changes alone.

## Qualification and remaining product follow-ups

- Full local check: 975 tests, 972 passed, zero failed, three existing skips.
- Strict CSP coverage remains intact; canvas layout variables use the existing runtime stylesheet helper rather than inline element styles.
- Browser walkthrough: first web stroke dismisses the welcome, undo restores the empty state, redo restores content, explicit save and reopen preserve content, and Blank/Grid controls update the paper choice.
- Quick-ask target measured at 48 by 48 CSS pixels below the toolbar in landscape (1280 wide) and portrait (768 by 1024). A deliberately unavailable local AI endpoint produced a retry message without a browser console error.
- Native-only content, canceled/stale activity, clear/restore, toolbar growth/shrink, viewport clipping, and lifecycle cleanup are covered by the regression harness. Physical Apple Pencil input remains a device acceptance check, not a browser-proven result.
- Remaining preexisting UX inconsistency: the top Pages action opens the legacy Canvas Library, while the bottom Pages & files action opens My notebook. Consolidating these should preserve both existing save paths and deserves its own migration-aware change.
- Remaining preexisting naming inconsistency: after loading a page, the quick-ask accessible name can revert from Ask the tutor to Run Auto AI now. The existing manual request handler still works.
- No changes to authentication, district Gateway routing, AI image payloads, notebook storage schema, or native Swift code. Hosted 1.3.1 is paired with the existing iPad 1.3.0 (25) release.
