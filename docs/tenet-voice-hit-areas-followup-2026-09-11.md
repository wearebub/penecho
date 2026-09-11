# PencilKit Talk/Lasso follow-up

Status: source changes only; not built, tested, versioned or published.

## Root causes addressed

Native control exclusions used ResizeObserver subscriptions collected once
before asynchronously mounted controls existed. Loading their external CSS
could enlarge or reposition Talk/Lasso without refreshing the native holes.
The observer now tracks dynamically added control containers and open dialogs,
retires removed targets, and reacts to stylesheet/font completion. Exclusions
include a four-CSS-pixel edge margin, still clipped to the native canvas.

Voice startup treated an audio-engine start return as microphone readiness,
ignored native listening events, and had no client timeout for stalled bridge
calls. Starting/finalizing disabled the recording control. Startup now confirms
the first nonempty native audio buffer before resolving or displaying Listening.
A five-second no-input deadline releases a failed native start. Client bridge
calls are bounded; starting/finishing remain cancellable. Cancellation retires
the attempt identity before late callbacks can change UI. Opening an initial
popover no longer dispatches an unscoped cancellation.

These are identified implementation defects and recovery gaps, not a claim
that the physical iPad failure has been reproduced or that all audio-service
failure modes are fixed. Both hosted and native qualification are required.

## Considered and rejected

Do not simulate extra clicks, expand the whole canvas into a button, assume
speech is recording from UI state, or send incomplete speech after a timeout.
Do not retry by starting overlapping native sessions. The microphone indicator
is confirmed by input, not guessed from a successful bridge enqueue.

## Intentionally unchanged

Both ink engines, document coordinates, notebook archives, district routing,
minimum-hint policy, authentication and 1.5-second word-pause semantics remain
unchanged. No raw audio leaves native code or enters logs. The audio callback
uses a nonblocking readiness flag and sends only readiness to the main queue.
Microphone styling is white with a purple outline/icon matching the star;
both entry controls retain explicit 52-by-52 CSS-pixel targets.

## Required qualification before release

Add behavioral regression coverage for late stylesheet/control mounting,
button edge exclusions, confirmed native startup, stalled startup/stop calls,
retry/cancellation and late callbacks. Run the full suite, macOS native compile
and signed build before publishing a new version. On iPad, test all button
edges with finger and Pencil, already-granted permissions, denied permission,
route changes, no microphone input, speech finalization and page cancellation.
