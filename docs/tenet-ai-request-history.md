# Prospective local AI request inputs

Ordinary Tenet saved-page history observes the JSON body constructed by
`requestAI` for `POST /api/ai/command`. The same immutable serialized string is
passed to fetch and the optional local observer. Nothing is sent to a new
destination. Transport, authorization, hint policy, crop construction, and
native drawing behavior are unchanged. The manual assignment preview remains
separately gated.

## Viewer contract

- `ai.request`, `ai.input`, `ai.response`, and `ai.finished` join on
  `details.localRequestId`. This is local correlation, not server attestation.
- New request/input records carry `inputVersion: 1` and `origin`:
  `quick-help`, `specific-question`, `voice-question`, `automatic`, or `unknown`.
- Origin describes the observed submit path. Voice identifiers and raw audio
  are not retained. A voice-path transcript may have been edited before submit.
- `ai.request.questionSource` distinguishes `selection-question`,
  `canvas-typed-input`, and `none`. A typed canvas textbox is context, not proof
  that the student used the specific-question dialog.
- `ai.input.details` includes `boundary: "client-to-whiteboard"`, `method`,
  `endpoint`, `requestRevision`, `requestObservedAt`, `bodyStatus`, `bodyFormat`,
  `bodyExact`, `imageStatus`, `bodyAssetName`, `imageAssetName`, and `omitted`.
- `bodyStatus` is `recorded`, `partial`, or `unavailable`. `bodyFormat` is
  `raw-client-json`, `redacted-client-json`, or null when unavailable.
- `imageStatus` is `recorded`, `not-submitted`, `omitted`, or `unavailable`.
- `ai-input.json` is an `application/json` Blob containing the actual request
  body, not a wrapper. For `raw-client-json` it retains the serialized body
  including its atlas data URL. Explicit sensitive header/credential properties,
  if present in a future body extension, are omitted and marked partial; this
  safeguard is not DLP or a scan of free-form student text.
- `ai-input.png`, `ai-input.jpeg`, or `ai-input.webp` is a convenience attachment
  containing exactly the decoded submitted atlas bytes, without re-rendering or
  another crop. Remote image URLs are never fetched by capture.
- The viewer must exclude **all `ai.input` images and `ai-input.*` assets** from
  page checkpoints, page-image caching, and page-frame metrics.
- Asynchronous input attachments can arrive after response/finished events.
  Event `timestamp` and `sequence` retain append-time/order semantics;
  `requestObservedAt` preserves the original local observation time. Join by ID,
  not adjacency. There is no newly measured duration field.

Label these records **Whiteboard client request**, never complete downstream
Gateway/provider input. `observation` is `prepared-client-request-not-server-receipt`
and `gatewayProviderPromptObserved` is false. The server can transform imagery,
add prompts or policy, or reject the request. None of that is attested here.

## Bounds and lifecycle

The body is capped at 12 MiB UTF-8 and the separate image at the existing 8 MiB.
There are at most two attachments per event. Existing SHA-256 references,
64 MiB document history, 5,000-event retention, 12 KiB event details, 16 MiB
per-asset reader cap, saved-page transaction, and import/read checks remain.
Explicit header/credential-field inspection is bounded to 8,192 entries and
32 levels. Oversized or unsupported input is marked omitted, never silently
presented as complete. Raw JSON and its convenience image deliberately share
the same bounded history budget even though image bytes are also base64 in JSON.

The asynchronous queue admits at most two jobs and 12 MiB source characters
in aggregate. Each job has the existing 12-second operation bound. AI does not
await it. Save flush drains already-admitted jobs; later completions make history
dirty rather than being acknowledged by an older save. Page/account/epoch
boundaries invalidate pending inputs, clear queued body references, and retain
explicit coverage gaps. Immutable historical request data does not acquire a
later drawing revision when hashing completes.

## Legacy and incomplete records

Do not backfill old saves. Missing origin is unknown; missing `ai.input` or a
missing referenced attachment means that input was not recorded/retained.
Existing question summaries are not a reconstruction of the full request.
Inspect `bodyStatus`, `imageStatus`, `omitted`, coverage gaps, and retention
warnings before claiming availability. A complete raw body can exist even when
the convenience image is omitted; that distinction must remain visible.

No LMS, remote teacher service, provider-prompt archive, or consent redesign is
implemented by this capture addition.
