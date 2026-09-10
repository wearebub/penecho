# Circle help, recent-writing scope, and static illustrations

## User feedback and observed evidence

On September 10, 2026 the user reported that PencilKit Quick Ask considered old
writing, requested an explicit circle-and-ask flow in both engines, and reported
a failed triceratops illustration.

Read-only production logs near the supplied 11:34 AM Chicago screenshot showed:

- 16:31:12 UTC: request `9d0690f8-ff66-4fcc-9753-e2231accf184`, successful text-only hint.
- 16:32:06 UTC: request `6664d7cf-d058-48f7-a367-5b555c20a110`, application 502 with `model-error`.
- 16:33:41 UTC: request `177ffcfd-7000-46df-ae03-4dba3a8194ba`, successful text-only hint.

The three upstream Gateway journal entries were successful HTTP 200 completions.
Raw model exchanges and request traces are disabled in Tenet mode; the exact
failed response format cannot be reconstructed from those logs. No raw logging
was enabled to investigate. Future failures receive a bounded category, never
raw SVG, handwriting, prompt text, or model content.

## Root causes and chosen approach

Quick Ask explicitly requested current-viewport capture. Even when latest-input
metadata exists, the model still receives older visible context. The new Tenet
control distinguishes Recent writing from Visible page. Recent writing captures
the visible intersection of the accumulated unconsumed change rectangle (or the
last input rectangle); it is not a semantic guarantee of one word or one stroke.
Failed or unaccepted requests may leave a larger unconsumed region. Circle for AI
is the exact-context mechanism in either ink engine.

PencilKit's native lasso edits strokes; it does not select arbitrary mixed web
content for AI. The new circle overlay temporarily suspends native input, flushes
the drawing, and draws a selection without lifting, moving, erasing, or converting
ink. It composites confirmed web/native ink, images, text and widget snapshots
through a polygon clip. Only the masked PNG and optional bounded question enter
the existing Gateway request path. Old typed input, hotspots, native archives,
and unrelated pixels are excluded. Page revisions are checked before sending.

The Tenet model protocol previously instructed the model to describe pictures
larger than roughly ten primitives in words. Static illustrations now have a
dedicated restricted SVG-to-PNG protocol. The server allows only bounded vector
geometry and colors, rejects scripts, links, image/font references, CSS, filters,
entities, XML declarations, and external resources, then rasterizes with Sharp.
Only PNG bytes reach the client, where they use the existing persistent image
object and AI draft path. A generated cartoon is not a photographic image model
or web image search capability.

## Rejected alternatives and unchanged boundaries

- Rejected replacing PencilKit or turning its editing lasso into a destructive AI crop. Both ink engines remain selectable and native Swift is unchanged.
- Rejected silently sending the full page when an explicit crop is invalid or stale.
- Rejected enabling General HTML, arbitrary SVG DOM insertion, remote image fetching, or a second provider route to work around picture limitations.
- Kept district authentication, Gateway authorization/DLP, policy priority, inference budget ownership, and notebook schema unchanged.
- Explicit selection requests do not consume the ordinary recent-writing stream. Ordinary Recent writing requests do.

## Status

Source implementation in progress, not published. The selection SVG visibility
correction is pending user approval; do not build or deploy this UI until its
hidden state is represented by an explicit DOM attribute. Regression tests cover
crop masking/geometry, stale preparation guards, image boundaries, and bounded
questions. Test execution and physical iPad acceptance must be reported
separately, never inferred from source changes.

## Qualification update: 2026-09-10, publication held

This update supersedes the earlier pending SVG-visibility status. The approved SVG fix is applied: explicit hidden attributes now remove the circle surface from hit testing when inactive. The client bundle was regenerated.

The latest npm run check completed with 995 passed, 0 failed, and 3 skipped (998 tests). The image-draft contract assertions now explicitly retain plot_function and also require draw_image in both single and batch acceptance. A separate native-configuration test proves width changes reach the PencilKit bridge while zoom-only changes preserve the chosen physical line width.

The newly requested thickness control is outside the pen-only group. It is labeled Pencil thickness in native mode and Line thickness in web mode, with Thin 3 px / Medium 5 px / Thick 8 px presets, the existing supported slider range, and a live stroke preview. Browser interaction confirmed choosing Thick sets the slider and toolbar label to 8 px. This is not physical Pencil testing.

A local synthetic OpenAI-compatible fixture, with isolated temporary storage and no provider calls, exercised circle -> question -> image response. The server rasterized the restricted illustration to PNG and the client displayed a movable image draft. The captured request contained matching selection/source rectangles and the typed question. The local fixture retained synthetic request data only in the OS temporary directory.

### Remaining release blockers, awaiting correction approval

1. New Circle controls conflict with the upstream studio-toolbar-two-row four-column grid. The extra direct children get squeezed into the old navigator/divider columns (including a 1 px column), overlapping neighboring controls. Use a Tenet-scoped wrapping toolbar rather than altering the upstream layout globally. This also needs portrait/landscape and native-control layout qualification.
2. The illustration draft does NOT save yet. addPendingPlotImage passes plotExpression:"" for draw_image; imageRecord intentionally rejects an explicitly supplied empty plot expression. Omit graph metadata for ordinary illustrations. Do not weaken imageRecord's plot validation. Also align new image minimum dimensions with the existing image-record contract (80 logical units), and add a real acceptance/persistence regression instead of only command-shape assertions.
3. The browser captured an unlocated MutationObserver observe/non-Node exception. Establish whether this is app or browser instrumentation before claiming a console-clean demo.

Do not treat the green unit suite as end-to-end acceptance. No new commit, tag, upload, TestFlight build, or hosted deployment was made in this qualification pass.

The release publisher is prepared to include the selection stylesheet plus src/server/main.js and src/server/tenet-illustration.js in an explicitly labeled hosted-runtime TAR. Unlike earlier client-only overlays, it requires a coordinated server restart and backup of all changed runtime files. The current demo service also owns Gateway lifecycle, so deployment must account for its in-memory demo state rather than blindly reusing the client-only deploy helper. Existing Gateway rules, auth service, credentials, dependencies, and notebook storage were not modified.

Rejected shortcuts: publishing on unit tests alone; disabling image validation; replacing PencilKit; exposing external SVG resources; changing provider or district policy to make the image request succeed. Existing plots, raw ink archives, notebook formats, and authorization boundaries remain authoritative.

## Editing expansion qualification (2026-09-10, local only)

- Implemented the approved toolbar overlap and illustration-save corrections. Illustrations now omit empty plot metadata rather than weakening the shared image validator; placement uses the validator's 80-unit minimum.
- Added PencilKit-specific hiding of web-only eraser/pen property controls, with a separate visible thickness entry. The native palette remains responsible for native erasing.
- Replaced the large Insert layout with a searchable categorized menu: 33 basic shapes, 2D coordinate templates, static 3D/geometry templates, and additional shapes. These are local PNG objects, not interactive 3D graphing.
- Added eight-handle image, shape, widget, and editable AI-draft resizing through existing edit/history transactions. Corners preserve proportions; sides stretch. Already-accepted text flattened into ink is not made into a new editable object model.
- Local build/check: 1,034 total, 1,031 passed, 0 failed, 3 skipped. The source-order fixture was extended without dropping existing sections; the new save test's extraction was corrected to use the actual synchronous function declarations.
- Browser (synthetic localhost provider): compact Insert search found and inserted 3D axes; Circle for AI opened via ordinary click; a circled crop plus typed question produced a static triceratops image; accepting the image succeeded; Save succeeded; after a full reload, the Device library reopened the graph and illustration. This proves the save regression locally, not production-provider quality.
- Browser toolbar checked at 1024x768 and 768x1024; Circle controls no longer overlap the reasoning control. Quick AI remains visible. No error console entries were captured in this run; the prior unlocated MutationObserver error did not recur.
- RELEASE HOLD: browser validation caught all eight new resize buttons stacked at one position. Root cause: runtimeElementStyle is keyed globally, but the new module passes the same "tenet-resize-position" key for every button. Each handle needs an independent positioning rule. User was informed and asked to authorize correcting this newly authored bug; no correction or publication was performed in this turn.
- Rejected weakening image validation, replacing the native archive/object model, or changing Gateway policy to force images. Auth, district routing, student rules, provider credentials, native Swift, and stored notebooks were intentionally left unchanged.
- No new commit, immutable release, TestFlight build, or hosted deployment was made. Physical iPad Pencil/finger acceptance and eight-handle drag/undo qualification remain outstanding.

## Release candidate qualification update (2026-09-10)

The user authorized finishing all needed corrections and publication. The shared resize positioning key is fixed. A second regression now covers tapped-object selection before an edit transaction begins, so existing pictures and shapes expose handles without requiring a drag first.

- Build and complete check passed: 1,036 tests, 1,033 passed, zero failed, three skipped.
- Browser pointer drags exercised all four corners and all four sides. Corner drags preserved the opposite anchor and aspect ratio; side drags changed one dimension. Undo restored the initial rectangle, and redo restored the resized geometry (within existing snapshot rounding).
- The visible Line thickness dialog opens from the toolbar with thin/medium/thick presets and finger/stylus/Pencil input choices. Physical native testing remains distinct from browser validation.
- Hosted baseline inspection found only the previously committed Check/Practice action support missing from the running server. Its exact pre-deploy SHA-256 is fdfba486a9e63aff4d9155b86b665f36d742774c4e65f708c1a07fc239a04a3d. The release includes that action routing along with bounded illustration handling.
- A browser-captured MutationObserver error with no source URL or stack occurred once during this run. It did not interrupt the tested flows; its origin is unconfirmed, so this record does not claim an entirely clean browser console.
- Publish target: hosted runtime 1.4.0, paired with existing native TestFlight 1.3.0 build 25. Publishing alone is not deployment evidence. The deployment receipt will identify installed/served hashes, restart identity, and rollback files.
- Voice was discussed as a future concept only; no voice code was added.
