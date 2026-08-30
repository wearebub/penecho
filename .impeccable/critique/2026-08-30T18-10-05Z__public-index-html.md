---
target: PenEcho History/Recents/Agent History
total_score: 24
p0_count: 0
p1_count: 3
timestamp: 2026-08-30T18-10-05Z
slug: public-index-html
---
# PenEcho History / Recents redesign critique

Method: dual-agent critique (A: `/root/impeccable_assessment_a` · B: `/root/impeccable_assessment_b`) with independent ZAI peer review (GLM-5.3 and GLM-5.3-Flash), Apple Workbench UI, Apple Product Web, and PenEcho product constraints.

## Executive verdict

The interface does not have an “AI slop” visual problem. Its visual language is restrained, product-specific, and already close to a credible professional workbench. The primitive feeling comes from product semantics: one recovery job has been split across Recents, Canvas History, and Agent History, each with a different scope and object model.

The redesign should make Canvas the work object, Agent conversations its resumable activity, and storage/project metadata a secondary management concern. Recents becomes the single high-frequency resume surface; the right Agent history becomes a current-Canvas shortcut; Canvas Library becomes the low-frequency manager for Device, Server, Cloud, Project, Save copy, rename, move, and delete.

## Nielsen score

| Heuristic | Score / 4 | Evidence |
| --- | ---: | --- |
| Visibility of system status | 3 | Current, saved, busy, progress, Cloud, and disabled states exist, but are fragmented across three surfaces. |
| Match with the real world | 2 | Users want to continue work; the interface first asks them to understand snapshot, location, project, Canvas history, and Agent history. |
| User control and freedom | 3 | Save/discard/cancel, Escape, confirmations, and revision-safe loading are strong. |
| Consistency and standards | 2 | Three history surfaces have different scopes, row actions, focus behavior, and deletion patterns. |
| Error prevention | 3 | Unsaved-change protection and safe load application are strong; browsing location is still coupled to save destination. |
| Recognition rather than recall | 2 | Thumbnails and timestamps help, but users must remember the active storage scope and which history entry is authoritative. |
| Flexibility and efficiency | 2 | Recents has search and one-click opening, but no cross-source index, command shortcut, or complete keyboard menu behavior. |
| Aesthetic and minimalist design | 3 | Visual restraint is good; the Canvas History modal exposes too many management decisions at once. |
| Error recognition and recovery | 2 | Content is protected, but retry and restored-session confirmation are not consistently inline with the triggering row. |
| Help and documentation | 2 | Tooltips and location copy exist, but the relationship between Canvas snapshots and continuing Agent conversations is not explained. |
| **Total** | **24 / 40** | **Reliable foundations, but high cognitive load in the core resume journey.** |

## Anti-pattern verdict

- AI slop: pass. The product retains a PenEcho workbench identity; it does not look like a generic card dashboard or marketing surface.
- Product slop: present. The same “resume work” concept has three overlapping entry points and exposes internal storage concepts too early.
- Detector: clean (`[]`, exit 0) for `public/index.html`. This does not invalidate the interaction and accessibility findings, which require runtime evidence.
- Cognitive load: 6 of 8 checks fail. Resume, save, copy, browse, move, project management, and delete compete in the Canvas History modal.

## What is already strong

- Canvas remains the quiet center, with dense controls kept near the edges.
- Device, Server, Cloud, Project, Save, Save copy, rename, delete, previews, loading progress, and Agent continuation are real capabilities, not decorative placeholders.
- Cross-Canvas transitions protect unsaved changes. Loading decodes before replacing the active Canvas.
- Agent history restores the editable logical conversation and continues it; it is not a read-only transcript.
- ARIA labels, expanded/current/busy states, Escape handling, and focus-visible styling provide a useful accessibility foundation.

## Priority findings

### P1 — Three history entries do not share one mental model

Recents, the top Canvas History modal, and the Agent History popover all use “history” language while answering different questions. A user must learn the implementation architecture before they can continue yesterday's work.

Fix: make Recents/Work history the only global resume entry. Rename the Agent shortcut to “Sessions on this Canvas.” Rename the full modal to “Canvas Library” or “Manage Canvas storage.” Preserve every existing capability.

### P1 — Recents is not truly recent work

The Canvas list only reflects the current `snapshotLocation` and is truncated to seven items. A Canvas can appear missing simply because the user does not remember whether Device, Server, or Cloud was last selected.

Fix: aggregate a read model across available sources and sort by last activity. Show location as a row badge. Treat signed-out or unreachable sources as isolated inline states rather than blanking the whole navigator. Until aggregation exists, show the active source clearly and offer an explicit source filter plus “View all in Library.”

### P1 — Narrow layouts allow two panes to consume the working surface

At 820 px, concurrent Recents and Agent panes leave roughly 244–316 px of visible Canvas depending on the measurement method, about 30–39% of the viewport. The current transparent scrim also blocks the Agent while leaving it visually active.

Fix: below 1100 px, full Recents and Agent panes are mutually exclusive. Opening Work history collapses Agent to a functional rail; at 820 px only one temporary sheet can be open. A blocking scrim must be visually perceptible and focus must remain inside the sheet.

### P2 — Rows show storage metadata before task evidence

Date-based Canvas titles, tile counts, `New conversation`, and `0 messages` do not answer “which piece of work was this?”

Fix: prioritize explicit Canvas name or first user intent, latest meaningful question/result summary, relative time, location badge, and current/unsaved/sync state. Keep tile/image counts in detail views. Hide or demote empty/error-only sessions from the main recent list.

### P2 — Focus and menu semantics are incomplete

The Agent history uses `menu/menuitem` but opening it leaves focus on the trigger and Arrow Down does not enter items. The History overlay also leaves focus behind the surface. Runtime contrast checks found several `--ai-faint` labels around 3.73–4.03:1, while metadata reaches 10 px in places.

Fix: either implement roving menu focus (Arrow Up/Down, Home/End, Escape and return focus) or use ordinary list semantics. Move focus into blocking surfaces, trap and restore it. Use at least 12.5 px for body/help text and 11–12 px for status metadata, with AA contrast.

### P2 — Recovery is safe but not visibly complete

Loading failure keeps the active Canvas safe, yet retry and pending Agent-session intent are not consistently shown at the triggering row. Successful continuation is inferred rather than announced.

Fix: keep row-level loading/error/retry. On success announce: “Restored [Canvas] · continuing [conversation].” If a cross-Canvas session load fails, retain the pending target and offer “Retry and continue” or Cancel.

## Recommended information architecture

```text
Work history
  Search work…                         All sources ▾

  Current
    [preview] Canvas A       Edited · Device
              Current Agent conversation

  Recent work
    [preview] Canvas B       12m · Cloud
              ▾ 3 Agent conversations
                 Triangle analysis        12m
                 Fix chart labels          1d

    [preview] Canvas C       Yesterday · Server

  Manage Canvas Library…
```

The default view is grouped by Canvas, not a flat mixed feed. Optional `All / Canvases / Agent` controls are filters over one index, not separate product areas.

### Responsibility by surface

| Surface | Primary job | Includes | Excludes |
| --- | --- | --- | --- |
| Work history / Recents | Resume and switch work | Search, current, recent Canvas, nested sessions, source/status badges | Project administration, persistent delete controls, save composer |
| Sessions on this Canvas | Fast local conversation switch | Recent conversations for active Canvas, current state, Continue | Global search, storage, Canvas management |
| Canvas Library | Explicit management | Device/Server/Cloud, Projects, rename, move, save copy, delete, Cloud sign-in | Default high-frequency resume journey |
| Unsaved-change dialog | One blocking decision | Save and open, Save a copy and open, Discard and open, Cancel | Browsing or unrelated management |

## Core flows

1. Current Canvas session: choose a session and continue directly; no save prompt and no read-only mode.
2. Another Canvas: click the Canvas row, then load immediately unless unsaved changes require one decision.
3. Session on another Canvas: retain the target session, run the same unsaved guard, load the Canvas, then restore and continue that logical conversation.
4. Cloud signed out: Device and Server remain usable; Cloud shows an inline sign-in action and returns to the intended row afterward.
5. Load failure: leave the current Canvas untouched; show inline Retry with target name/source and preserve pending session intent.
6. Delete: place in the row overflow, use a product dialog, explain whether Canvas or only Agent conversation is deleted, and disable deletion of a running current session.

## Responsive contract

| Viewport | Work history | Agent | Canvas Library |
| --- | --- | --- | --- |
| 1440 | 240–280 px docked or transient navigator | 336–384 px docked; keep Canvas near 60% of first viewport | 600–760 px sheet/modal for explicit management |
| 1100 | 280–320 px temporary sheet; opening it collapses Agent | Functional 44–52 px rail while history is open | Temporary centered or side sheet; never three full regions at once |
| 820 | Single 300–320 px sheet or near-full-width overlay, closes after selection | Mutually exclusive sheet | Full-height/near-full-width sheet; ≥44 px touch targets |

## Acceptance criteria

- Recent work can be identified and opened in at most two actions from the Canvas.
- A session on the current Canvas continues with one click from the Agent shortcut.
- A session on another Canvas needs at most two actions plus one unsaved-change decision when required.
- At 1440 px the primary Canvas retains approximately 60% of the first viewport; at 1100 px and below only one full side pane is open.
- No page-level horizontal overflow at 820 px.
- Body/help text is at least 12.5 px; status metadata is 11–12 px; normal text meets 4.5:1 contrast.
- Blocking surfaces receive focus, contain focus, close with Escape, and restore focus. Menu roles match keyboard behavior.
- Device/Server/Cloud capabilities, Projects, Save, Save copy, rename, move, delete, previews, progress, Cloud sign-in, and editable Agent continuation remain available.
- Resume success explicitly names the Canvas and conversation; failures preserve the current Canvas and offer inline Retry.

## Suggested delivery order

1. Distill: rename and assign clear scopes to the three existing entries; make Work history the global resume authority.
2. Layout/adapt: enforce mutual exclusion at 1100/820, add visible temporary-sheet behavior and correct focus ownership.
3. Information architecture: unify Canvas-grouped rows, task-evidence summaries, source/status badges, and source-aware search.
4. Library separation: move low-frequency management out of the primary resume path while retaining all capabilities.
5. Polish/harden: keyboard menus, focus restoration, contrast/type floor, inline retry, success announcements, loading and signed-out states.

## Personas

- Alex, expert: needs one authoritative recent-work index, cross-source search, fast resume, and no forced storage-model decisions.
- Jordan, newcomer: needs task-language labels and a visible Canvas → Agent conversation relationship.
- Sam, keyboard/screen-reader user: needs correct surface focus, predictable list/menu navigation, readable metadata, consistent dialogs, and announcements.

## Minor observations

- The modal title `History` is less specific than its trigger `Canvas history`.
- Server copy has a `1 images` pluralization issue.
- Canvas deletion uses browser `confirm` while Agent deletion uses an in-product dialog.
- Long Agent titles can ellipsize even for `New conversation` in the current 234 px popover.
- Multiple visible targets are below 44 px; acceptable for pointer-dense desktop UI, but not for the 820 touch sheet.

## Run notes

- Stable target: `public/index.html`; slug: `public-index-html`.
- Assessment A used a separate Browser tab and did not run the detector.
- Assessment B used another isolated Browser tab, ran the bundled detector successfully, and did not read A.
- Detector: exit 0, JSON `[]`, zero findings.
- `.impeccable/critique/ignore.md`: absent; no ignore entries applied.
- `PRODUCT.md`: absent. This scoped existing-interface critique continued without initialization; `$impeccable init` can later record durable product context.
- Mutable Browser injection was unavailable, so no overlay or live-server was used. Evidence came from DOM snapshots, screenshots, computed style, focus, contrast, and overflow measurements.
- No application source was changed by the critique.

Questions skipped: the evidence converges on a clear architecture and the user asked for a planning recommendation, not an implementation decision. The largest remaining uncertainty is whether cross-source aggregation should ship immediately or begin with an explicit source filter before the unified read model is ready.
