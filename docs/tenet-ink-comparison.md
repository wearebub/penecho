# Tenet ink comparison

This standalone module supports a fair, on-device comparison of Web ink and
PencilKit in the same notebook. The underlying need is to compare two renderers
under comparable tasks and settings while preserving existing work.

The comparison module is integrated with the canvas ink adapter and native Swift
surface. The main integration has passed 34 focused source tests and the hosted
macOS simulator and signed-device builds. Local browser checks use an explicit
mock bridge; real iPad drawing quality must still be graded in TestFlight.

## Integration and public API assumptions

Concatenate `tenet-ink-comparison.js` before `ui-bootstrap.js` inside the existing
canvas closure. Its leading semicolon and private IIFE prevent closure-variable
collisions. It uses the DOM and `window.TenetInk`; it does not access canvas
internals, private bridge messages, or native code.

The module expects the following public contract:

| API | Assumption |
| --- | --- |
| `available` | Exactly `true` enables the feature. No UI or storage access is started when it is false or absent. |
| `getStatus()` | Synchronously returns `{ engine: 'web' \| 'pencilkit', busy: boolean, nativeAvailable: boolean, strokeCount: nonnegative integer or null }`. Web ink reports null because its raster layer has no authoritative stroke inventory. |
| `setEngine(engine)` | Resolves after the requested renderer is active; rejects on failure. It preserves notebook work and respects existing suspension reasons. |
| `flush()` | Resolves after pending ink is committed and its diagnostic events have been dispatched. It does not clear work. |
| `suspend(reason)` | Hides the native surface before the DOM dialog opens. The module uses a dedicated reason string for each page lifecycle. |
| `resume(reason)` | Removes only this module's suspension reason. Repeated removal of the same reason must be harmless; other suspension reasons remain active. |
| `tenet:ink-status` | A window event with the same status object as `getStatus()`. Emit it after status changes and when a late-created API becomes available. |
| `tenet:ink-sample` | A window event with `{ engine, kind: 'stroke', durationMs?, sampleCount?, commitMs? }`. One event represents one completed stroke; timing values are finite nonnegative milliseconds and sample counts are nonnegative integers. |

Both synchronous and Promise-returning `suspend` / `resume` implementations are
accepted. Operations must settle; the module does not invent a cancellation API
or race a still-running native switch with a second switch. A rejected operation
returns controls to an idle state, rereads actual status, and announces a failure.
A failed resume retains its owned reason and exposes **Retry drawing**.

If the API is initialized before DOM readiness, controls mount at
`DOMContentLoaded`. If it is initialized later, dispatch `tenet:ink-status`.
Initial absence of the API does not cause errors, polling, or storage writes.

The preferred top-toolbar insertion point is `[data-tenet-ink-toolbar]`. Existing
`#top-toolbar`, `#topToolbar`, `[data-toolbar="top"]`, `.top-toolbar`,
`header [role="toolbar"]`, and `#toolbar` containers are also recognized in that
order. If none exists, a small fixed top toolbar is provided. A bounded ten-second
DOM observer allows the later bootstrap to create a toolbar. Add the preferred
attribute in the main integration if the existing toolbar uses another selector.

## Trial flow

1. **Ink: Web** or **Ink: PencilKit** switches asynchronously after flushing.
   PencilKit is disabled when unavailable. This clearly labeled button is a
   renderer toggle; it never clears the notebook.
2. **Compare ink** flushes pending ink, suspends the native surface, and opens a
   responsive, labeled dialog. A native modal dialog is preferred; the DOM
   fallback provides a backdrop and focus containment. Close and Escape restore
   focus and release the module's native suspension reason.
3. Choose a renderer and task. Keep the Pencil, pen settings, notebook area,
   starting zoom, and content comparable. The full routine includes writing a
   sentence, fast loops, small math, and pan/zoom/graph manipulation. Each task can
   also be run independently. Graph setup is done with the existing notebook
   tools before either trial.
4. **Start trial** flushes old events, closes the dialog, resumes the native
   surface, and begins collecting diagnostics only after the engine is ready.
   A floating **Stop and rate** control leaves the notebook available for drawing.
5. Both local renderer controls stay disabled during the trial. **Compare ink**
   also becomes **Stop and rate**, so reopening the dialog ends the trial first.
   Stop ends timing, flushes the last stroke, retains the diagnostic record, and
   opens the rating form. A failed flush marks the record interrupted.
6. Rate smoothness, accuracy, and tool usability from 1 (poor) to 5 (excellent),
   and enter a manual missed-stroke count. Save or explicitly skip ratings before
   starting another trial. Unrated diagnostics are already retained at stop.
7. Switch engines after stopping and repeat the same task. Reversing engine order
   for a second pair can help expose practice or ordering effects. The module
   does not calculate a winner or impose a synthetic combined score.

If another integration changes engines or removes native availability during a
trial, status events terminate the trial as interrupted. The module cannot lock
other engine controls through the stated API. The main integration should avoid
external renderer changes during an active comparison. Samples from another
engine are always ignored.

Controls have at least 44 CSS pixels of height and width, visible focus rings,
explicit labels, and accessible status/error announcements. Scoped CSS uses warm
paper colors and navy with no fonts, images, or dependencies fetched externally.

## What the diagnostics mean

| Field | Meaning and limitation |
| --- | --- |
| `timing.visibleMs` | Time while the trial is running and the document is visible. Setup, switching, the dialog, and the stop flush are excluded. |
| `timing.hiddenMs` | Hidden-page time excluded from active time. It is not treated as a slow frame or drawing stall. |
| `strokeDiagnostics.events` | Completed-stroke events received for the selected engine while visible, including final events drained by the stop flush. This is not automatic missed-stroke detection. |
| `ignoredHiddenEvents` | Matching stroke events received while hidden and excluded from diagnostic aggregates. |
| `startStrokeCount`, `endStrokeCount` | Engine-reported inventory snapshots, which can include existing artwork. Their nonnegative delta is a separate diagnostic, not a physical stroke count; it can include changes made while hidden. A decrease or unavailable end count produces a null delta. |
| `strokeDurationMs` | Optional per-stroke software duration supplied by the adapter. It is not display latency. |
| `samplesPerStroke` | Optional adapter sample count per completed stroke. Sampling definitions may differ between engines. |
| `commitMs` | Optional software commit duration supplied by the adapter. Compare its implementation boundaries before interpreting engine differences. |
| `frameIntervalsMs` | Intervals between this web page's consecutive animation callbacks, with count, mean, minimum, maximum, population standard deviation, and count above 33 ms. These are not native compositor or screen presentation timestamps. |
| `ratings`, `missedStrokes` | The user's impressions and manual observation. Skipped entries remain null. |

Frame measurement uses `requestAnimationFrame` only during an active, visible
trial. `visibilitychange` cancels the callback and resets the previous timestamp;
the first frame after returning establishes a new baseline. No interval spans
hidden time. Aggregates update online in constant memory; no raw frame or stroke
event arrays accumulate. Optional metrics that are absent or invalid are ignored.
An empty aggregate has count zero and null values, so unavailable metrics are not
misrepresented as zero-duration performance.

No diagnostic here measures hardware Pencil-to-pixel latency. Measuring that
requires an independently qualified end-to-end method. Web animation callbacks,
stroke elapsed time, and native commit timing do not establish when pixels became
visible after physical Pencil contact.

## Local storage and export

The module retains the most recent 20 stopped or interrupted trials under
`localStorage['tenet.ink-comparison.v1']`, with a versioned envelope. Records include
only engine/task identifiers, local trial timestamps, timing and stroke summary
diagnostics, completion state, ratings, and manual missed-stroke counts. There are
no artwork coordinates, pressure traces, image data, notebook/document IDs,
free-text notes, authentication values, or session data.

Results are kept in memory first. Storage denial, quota exhaustion, malformed
saved data, or serialization failure does not discard current in-memory results.
An accessible notice asks the user to export before leaving when saving fails.
Without successful storage or an export, an actual reload or closed page cannot
preserve memory. Loading and exporting reconstruct a strict whitelist of fields;
unrecognized stored fields are never forwarded to the download.

**Export JSON locally** creates an `application/json` Blob and clicks a temporary
download anchor in the user gesture. The browser manages the local download. No
network request, telemetry call, or file upload is made. The anchor is removed and
the object URL is revoked after 60 seconds or page teardown. Exports include the
metric limitations and fixed task instructions for context. An unrated trial
exports with null ratings; save entered ratings before exporting to include them.

## Lifecycle and ownership

`pagehide` stops frame callbacks, retains an active trial as interrupted without
waiting for native work, unregisters owned DOM and window listeners, disconnects
the toolbar observer, clears timers/download URLs, removes injected DOM and CSS,
and attempts to release only the comparison's native suspension reason.
Generation checks prevent asynchronous operations from updating a disposed UI.
A page entering the back-forward cache installs one one-shot `pageshow` listener
to recreate the UI and listeners on restoration, retaining its in-memory results.
An interrupted pagehide snapshot may omit the final unflushed native stroke.

The comparison deliberately rejects duplicate notebooks as a comparison mechanism:
they change content and synchronization conditions and would couple this module
to notebook internals. It also rejects claims of synthetic Pencil latency based on
browser scheduling or commit timers. Existing notebook rendering, engine migration,
native Swift, graph behavior, and toolbar/bootstrap integration remain owned by
the main agents. Gateway behavior, AI prompts, and authentication are unchanged
because none is needed for local renderer comparison.
