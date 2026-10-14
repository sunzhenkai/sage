# @sage/agent-web

Linear-style web console for `@sage/agent-api` (Fastify HTTP/JSON + SSE).
Stack: Vite 7 · React 19 · TypeScript · Tailwind CSS 4 · shadcn/ui-style components (Radix + cva) · react-router 7 · TanStack Query 5 · cmdk.

## Run

```bash
cd platform
pnpm install
pnpm --filter @sage/agent-web dev        # http://localhost:9620
pnpm --filter @sage/agent-web typecheck
pnpm --filter @sage/agent-web build      # -> apps/agent-web/dist
pnpm --filter @sage/agent-web preview    # serves dist with the same proxy
```

The dev/preview server proxies `/v1`, `/livez`, `/readyz` to `AGENT_API_URL` (default `http://127.0.0.1:9610`).
Override the port with `AGENT_WEB_PORT`. In **Settings** you can instead point the browser straight at another
API base URL (agent-api must then allow CORS), set a **service token** (sent as `Authorization: Bearer …`; required by
`/v1/schedules`), the **tenant id** used in schedule definitions, and the theme (light / dark / system).
Settings live in `localStorage` (`sage.agent-web.settings`).

## Pages → endpoints

| Route | Endpoints |
| --- | --- |
| `/chat`, `/chat/:sessionId` | `GET/POST /v1/chat/sessions`, `GET/DELETE /v1/chat/sessions/:id`, `POST …/archive`, `POST …/unarchive`, `POST …/messages`, `GET …/events`, `GET …/timeline` (SSE, resumed via `afterSequence`), `POST /v1/chat/runs/:runId/retry`, `GET /v1/run-agent/settings` (provider picker) |
| `/tasks` | `GET /v1/tasks?status&limit` |
| `/tasks/:taskId` | `GET /v1/tasks/:id`, `GET …/events`, `GET …/run-logs`, `GET …/artifacts`, `GET …/artifacts/:artifactId`, `POST …/signals` (pause/resume), `POST …/cancel`, `POST …/retry` |
| `/apps`, `/apps/:appId` | `GET /v1/apps`, `GET /v1/apps/:id`, `DELETE /v1/apps/:id` |
| `/packages`, `/packages/:id` | `GET /v1/packages`, `GET /v1/packages/:id` |
| `/schedules`, `/schedules/:id` | `GET/POST /v1/schedules`, `GET/DELETE /v1/schedules/:id`, `GET …/triggers`, `POST …/pause`, `POST …/resume` |
| `/providers` | `GET/POST /v1/provider-connections`, `DELETE /v1/provider-connections/:id`, `GET/PUT /v1/run-agent/settings`, `GET /v1/provider-catalog/status` |
| `/settings` | `GET /livez`, `GET /readyz` |

Not surfaced (yet): `POST /v1/tasks` (needs a pre-staged `task-input://` ref), `PUT /v1/provider-connections/:id`
(client method exists, no edit UI), `/v1/provider-catalog/{providers,models,sync,check-connection}`,
`POST /v1/chat/messages/:id/promotions`, `POST /v1/effects/resolutions`, `POST /v1/production/effects/:id/resolution`,
`/internal/*`.

## Notes

- Wire types are mirrored in `src/lib/types.ts` from `@sage/app-contracts` / `@sage/task-domain` / agent-api route
  code so the browser bundle has no server-side deps; `package-ownership.json` declares `agent-web` with no `@sage/*` deps.
- SSE uses a `fetch` stream reader (not `EventSource`) so the bearer token can be sent; reconnects with backoff.
- Keyboard: `⌘/Ctrl+K` palette, `G` then `C/T/A/P/S/M/,` to navigate, `Enter` to send.
- The app is not part of the root `tsc -b` project graph (it is a bundled DOM app with `noEmit`); use the package scripts.

## Overview & mock mode

- `/overview` (default landing) — stat tiles with sparklines and charts (recharts, themed via `--chart-*` tokens) computed from sessions, session runs, tasks, schedules/triggers. Empty data renders ghost charts.
- Mock mode (dev only, read-only): open any URL with `?mock=1` (persists in localStorage, `?mock=0` or the sidebar "Exit" clears it), or start with `VITE_MOCK=1 pnpm dev`. All GETs are served from a deterministic in-memory dataset; every write is rejected client-side (`MOCK_READ_ONLY`) so agent-api is never called.
