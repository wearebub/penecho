# Tenet Whiteboard 1.7.1 qualification

## Root causes

- Initial voice opening passed no stable key to `runtimeElementStyle`, then dereferenced null before painting or starting the recorder. Record again bypassed that positioning path. Popover positioning now uses a stable key and cannot prevent recording startup.
- Native listening previously meant the audio engine had started, not that it had delivered input. Listening now requires a nonempty audio buffer, current authority/generation, and an active engine. Bounded startup and cancellation make failure recoverable.
- Native exclusion rectangles did not consistently follow late controls and stylesheet-driven size changes. Observed controls now refresh dynamically, with a four-pixel margin only for controls actually overlapping the canvas.
- Permanent file actions, drawing controls, and the context selector consumed canvas space. The native header now has a notebook menu and a drawing-tools toggle. The original fixed-width file-action styling also squeezed the new Tools label; the compact controls explicitly override that width.

## Considered and rejected

- A second auto-start recorder was rejected: opening and Record again must use the same recorder lifecycle.
- Removing microphone readiness checks was rejected: a running engine alone did not prove input.
- Replacing original file-action buttons was rejected: moving their existing nodes retains their listeners, export behavior, and disabled states.
- Hiding the native PencilKit palette was rejected: the requested collapse applies only to the web drawing-controls row below the title.
- Changing AI scope defaults was rejected: this is a presentation change, not a change to what student work is sent.

## Intentionally unchanged

District routing, authentication, student rules, Socratic prompts, selected-crop boundaries, on-device-only speech requirements, and the 1.5-second transcript-pause policy are unchanged. Web/Chromebook chrome is unchanged. The root lockfile contains only release-version changes, with no dependency or peer-annotation churn.

## Local qualification

- `npm.cmd run check`: 1,165 tests, 1,162 passed, zero failed, three skipped; includes client bundle generation.
- Focused voice/native tests cover initial microphone entry versus Record again, stable runtime styling, optional-layout failure, missing audio acknowledgement, cancellation/late completions, startup timeout, dynamic hit areas, and native input readiness contracts.
- Browser preview at 1280 x 720 with an explicitly simulated iOS Capacitor bridge: drawing controls start collapsed; Tools expands and collapses them; notebook menu contains New/Open/Export PDF/Pages; existing Recent writing/Visible page selector moves into Tutor view and preserves its selected value; initial microphone entry invokes recognition and reaches Listening without typing; mic is white with a purple border; mic and circle controls have 52-pixel bounds and accept center/edge hits.
- This browser fixture does not exercise actual iPad hardware, PencilKit, microphone permission prompts, native dictation, or Apple processing. macOS compilation and signed-upload evidence belong in the release receipts. Physical-device acceptance remains separate from publication.

## Release status

Prepared for authorized testing and publication. Exact source commit, immutable release tags, workflow results, hosted runtime hashes, and rollback records are recorded separately under `docs/releases/` after publication.

## Publication evidence

Source b9fb0ee7f1bf0db0ed996912c3e64788fd14666e passed local checks and hosted Node 22/24 CI. Hosted 1.7.1 installed at 2026-09-11T15:12:54.615Z; iPad 1.7.1 build 41 uploaded successfully at 2026-09-11T15:13:32Z. Immutable artifacts, independent hash checks, exact workflow results, and guarded hosted rollback instructions are recorded under docs/releases/tenet-web-v1.7.1 and docs/releases/tenet-ipad-v1.7.1-build.41. No physical-iPad acceptance or Apple-processing completion is claimed.
