# Tenet Whiteboard 1.6.0: iPad interaction polish

Implementation notes. Release qualification, immutable source identities, hosted
deployment receipts and rollback commands are recorded separately under
`docs/releases/` after publication. This document alone is not deployment proof.

## Root causes addressed

- Drawing controls, AI entry points and comparison diagnostics accumulated in
  one toolbar. Talk now sits under Quick AI; Circle selection sits at the upper
  left of the canvas. Selection actions appear only after a circle is complete,
  avoiding an instruction panel that intercepts the circling gesture.
- A completed circle previously offered questions but no compatible movement
  transaction. Web ink now uses the existing tile selection undo transaction;
  PencilKit uses bounded, native PKStroke translations and normal native
  snapshot/history reconciliation. Movement affects the active engine's ink,
  not images, shapes or ink belonging to the other engine.
- Voice questions previously captured the visible page independently of the
  circle. Voice now carries a copied polygon and page/revision lease when
  launched from a selection. A stale selection fails rather than broadening
  the capture. A general voice question still explicitly uses the visible page.
- Native palette notifications could replace a requested web thickness with
  the palette's normalized width. Explicit width request IDs distinguish an
  intentional preset/slider action from a passive tool echo. Native ink type,
  color and prior strokes are preserved.
- Theme and layout rules left chrome translucent. Tenet-specific selectors
  now set opaque surfaces without changing the safe area or undoing the
  AI-draft Move/resize stacking repair.
- The expanded notebook launcher could obstruct notices. A separately stored
  UI preference collapses it into a side tab. Header Pages and the side tab
  should lead to the same subject-based notebook, not two separate libraries.
- Spoken replies previously preferred a default system voice. The native
  layer now prefers installed Apple premium, then enhanced, then default voices
  in the requested language. Availability depends on the device's installed
  voices; the UI explains how to obtain a higher-quality local voice.
- Compare Ink was testing scaffolding, not a student workflow. Its UI and
  benchmark processing are removed while the Web/PencilKit switch remains.

## Additional voice interaction requested during this pass

Talk to Tenet uses a compact popover rather than a full-screen menu. After
speech begins, 1.5 seconds of continuous detected silence should end capture
and automatically submit the final transcript. Native recognition finalization
may add latency after that silence interval. No-speech, cancellation, stale
page/session and permission failures must not auto-submit. Typed submission
remains available. These requirements need native-device acceptance in addition
to automated tests; browser checks cannot prove microphone behavior.

## Considered and rejected

- Flattening PencilKit strokes into a picture to move them: loses editable
  strokes and complicates native undo, recognition and saved-page ownership.
- A new cloud speech provider: would upload audio or add another data processor
  and billing path. This pass improves installed local Apple voices instead.
- Transcript-update debounce as a silence detector: recognition update cadence
  is not the same as continuous silence in microphone input.
- A global touch/gesture rewrite: the confirmed control interception and
  stacking issues can be fixed at their existing interaction boundaries.
- Replacing both ink engines with one: preserves the requested compatibility
  and comparison-by-use path without retaining the benchmark UI.

## Intentionally unchanged

District authentication, managed student configuration, Gateway enforcement,
provider credentials, notebook storage schema, public sharing restrictions and
the AI rendering protocol remain unchanged. The request-path audit found that
typed and voice questions used `answer` while Quick help used `hint`. At the
user's explicit request, these student question paths now consistently use
`hint`, whose contract permits natural conversation but offers clues for actual
problems. Existing Gateway rule text was not rewritten. See
`docs/tenet-ai-request-paths-2026-09-10.md` for the exact hosted demo rules.

Existing comparison records are not migrated or deleted. Existing notebook data
is retained. No dependency is added; root package and lockfile version fields
are bumped deliberately without npm-install peer-annotation churn.

## Device acceptance required

The integrated local `npm.cmd run check` passed: 1,113 total tests, 1,110 passed,
zero failed and three skipped. The final run includes the voice silence event
contracts, cancellation, old-binary fallback, selection scope/movement, native
width contracts and keyboard popover coordinate cases. A pre-existing relay
heartbeat timing test failed in an earlier parallel run, then passed in both an
isolated rerun and the final full run; its assertions were not weakened.

The isolated actual web UI confirmed opaque topbar/toolbars, successful circling,
context actions, an ink move, selected-area question preview, persisted launcher
collapse and header Pages opening the same subject notebook. No production
student content or provider request was used for those browser checks.

Check Pencil and finger taps on floating controls, thickness presets after
native palette changes, undo/redo after native movement, portrait/Split View,
keyboard popover placement, background/cancel during speech, silence with room
noise, selection-only spoken questions and installed voice quality. Automated
CI and hosted hashes are not a substitute for these physical iPad checks.
