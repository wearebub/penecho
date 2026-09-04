# PenEcho behind the Tenet District AI Gateway (MVP fork)

This branch (`tenet-mvp`, pinned from upstream `84d4f8d`, v1.1.7+1) runs PenEcho
as a governed client of the [Tenet District AI Gateway](https://github.com/wearebub)
so a district can put rules in front of an open-source AI application it did not
write. It is a local proof of concept, not a student-facing deployment.

## What Tenet mode changes

Set `PENECHO_TENET_MODE=1` (the launcher below does it for you). Everything
else in PenEcho is untouched when the flag is off.

| Area | Tenet mode behaviour | Why |
|---|---|---|
| Requests | `stream:false` on every provider call (canvas, plugin authoring, community metadata, connection test) | The Gateway scans the whole response before releasing it and refuses SSE |
| `reasoning_effort` | Only `none/low/medium/high/xhigh/max` is sent; any other value is dropped | The Gateway accepts a closed set; PenEcho lets users type arbitrary values |
| `max_tokens` | `PENECHO_TENET_MAX_TOKENS` (default 8192, 256..32768) replaces the 20000 default | The Gateway reserves prompt + `max_tokens` against the key budget on every turn |
| Auto AI | Stroke-pause auto requests never fire; the AI orb is relabelled **Ask the tutor** and the Auto toggle is hidden | Request frequency is the cost driver; the presenter decides when a turn happens |
| Gateway outcomes | A banner shows the district rule that decided a refused turn: headline, closed code, category, and the Gateway audit id (`req_…`) | The demo is about rules acting visibly |
| System prompt | PenEcho's persona, plugin/HTML-widget routing, Agent fallbacks, and refine gate are not sent. The model gets the **Tenet tutor prompt** (district-dictated persona, K-12 safety baseline, never transcribe personal information into any field) plus only the canvas protocol the renderer needs | The district owns the AI; the Gateway's rules arrive first and are law, not guidance to reconcile |
| District guardrails | Selected in the Gateway admin strip (`student_safety_baseline` on by default, `spanish_immersion`, `socratic_minimum_hint`); the Gateway prepends them as a system message and audits the ids | Rules live in the Gateway, not the app |
| PenEcho Cloud, account linking, community publishing | `/api/cloud/*` and `/api/community/*` answer 404 `tenet_mode_disabled`; the Cloud connector is never started | Must be off for minors |
| Host-folder browsing | No roots are exposed; `/api/canvas-agent/*roots*` answer 404 | Every LAN browser could otherwise read host folders |
| Request tracing | Forced off | Traces store canvas images and prompts on disk |

## Run it

1. In the monorepo, start the Gateway demo host. It builds, starts the Gateway
   on `127.0.0.1:4141` with the canvas profile and the presenter-forced demo
   states enabled, issues the keys, and writes this repo's `.env.tenet`:

   ```powershell
   cd packages\tenet-gateway
   npm run penecho-demo:start
   ```

2. In this repo:

   ```powershell
   npm ci
   npm run build:client
   node scripts/start-tenet.js
   ```

   PenEcho listens on `http://127.0.0.1:3888` (set `HOST`/`PORT` in
   `.env.tenet` to change; `0.0.0.0` exposes it to the LAN).

3. Open the Gateway admin strip at `http://127.0.0.1:4141/local-admin` and flip
   the demo state between turns (`allow`, `block_policy`, `budget_exhausted`,
   `withhold_output`, `rate_limited`). Write on the canvas and click the orb.

`.env.tenet` contents (regenerated on every Gateway start; the key is shown
once and dies with the Gateway process):

```
AI_PROVIDER=api
AI_API_FORMAT=openai
AI_API_URL=http://127.0.0.1:4141/v1
AI_API_MODEL=tenet-code
AI_API_KEY=sk-tenet-dev-...
AI_EFFORT=medium
PENECHO_TENET_MODE=1
PENECHO_TENET_MAX_TOKENS=8192
PORT=3888
HOST=127.0.0.1
```

## Licensing

PenEcho is AGPL-3.0. This fork is self-hosted and points at our own backend;
the source of the fork stays public. Nothing here uses the PenEcho name or
marks as a product name: the demo calls it "PenEcho (open source) behind the
Tenet Gateway".

## Files touched by the fork

- `src/server/main.js`: `TENET_MODE`, `STREAM_RESPONSES`, reasoning/max_tokens
  bounds, Cloud/community/host-root refusals, `tenetGatewayError`, `gateway`
  field on AI error responses, `tenetMode` in `/api/config` and `/api/config.js`.
- `src/client/app/ai-runtime.js`: `showTenetGatewayBanner`.
- `src/client/app/canvas-agent-runtime.js`, `core.js`, `ui-bootstrap.js`:
  auto suppression, auto default off, orb relabel.
- `src/cli/main.js`: connection test honours `PENECHO_TENET_MODE`.
- `public/style.css`: banner styles.
- `scripts/start-tenet.js`: launcher.
