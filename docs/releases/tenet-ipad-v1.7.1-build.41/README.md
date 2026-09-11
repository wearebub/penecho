# Tenet Whiteboard 1.7.1 build 41

Status: signed IPA verified, TestFlight upload succeeded at 2026-09-11T15:13:32Z, and immutable release assets independently downloaded and hash-verified. Apple processing and physical-iPad acceptance have not been verified.

- Source: b9fb0ee7f1bf0db0ed996912c3e64788fd14666e.
- Release: https://github.com/wearebub/penecho/releases/tag/tenet-ipad-v1.7.1-build.41
- Workflow: https://github.com/wearebub/penecho/actions/runs/34613958395
- Annotated tag: 47200fa9490a601a4260e49cd4672712a814c701.
- IPA SHA-256: 79a412e40f17bb42b1b053ca34d8991413904a414a96dd74ee90f4b0a97ac984.
- Bundle: ai.truemade.tenet.whiteboard.

## Qualification

Full client CI passed on Node 22 and 24. The macOS unsigned Simulator compile, signed device archive, signed IPA verification, TestFlight upload, and immutable archival jobs all succeeded for the same source commit. Locally, 1,162 tests passed with zero failures and three existing skips. The compact browser preview used an explicitly simulated native bridge, not real microphone or PencilKit hardware. See ../../tenet-1.7.1-qualification.md.

## Scope and acceptance

Fixes first-open dictation startup, adds native audio-input acknowledgement and bounded cancellable startup, refreshes full control hit exclusions, gives the microphone a white/purple appearance, and introduces the notebook menu and collapsed drawing-controls row. The native floating palette remains available. Tutor context selection is relocated without changing its behavior. Authentication, district policy, selected-image boundaries, and local-speech requirements are unchanged.

Install this exact version/build in TestFlight before judging native microphone behavior. Confirm first-tap recording without typing, transcript-pause submission, finger/Pencil button taps, notebook file actions, and Tools expansion on the physical iPad. Hosted publication alone cannot replace the native binary.

## Rollback identity

Prior native source and IPA remain archived under tenet-ipad-v1.7.0-build.40. Do not move an immutable tag or overwrite its IPA. A future rebuild of prior source must receive a new build number. Hosted rollback is separate and recorded under ../tenet-web-v1.7.1.
