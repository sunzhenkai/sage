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
API base URL (agent-api must then allow CORS), set the **tenant id** used in schedule definitions, and the theme
(light / dark / system). `/v1` requests carry no credentials yet — user login/auth is the next layer. The **MCP** page
holds the API key used only by external MCP clients (same key as `SAGE_SERVICE_TOKEN_HASHES`).
Settings live in `localStorage` (`sage.agent-web.settings`); older `serviceToken` values migrate to `mcpApiKey`.

## Pages → endpoints

| Route | Endpoints |
| --- | --- |
| `/chat`, `/chat/:sessionId` | `GET/POST /v1/chat/sessions`, `GET/DELETE /v1/chat/sessions/:id`, `POST …/archive`, `POST …/unarchive`, `POST …/messages`, `GET …/events`, `GET …/timeline` (SSE, resumed via `afterSequence`), `POST /v1/chat/runs/:runId/retry`, `GET /v1/run-agent/settings` (provider picker) |
| `/tasks` | `GET /v1/tasks?status&limit` |
| `/tasks/:taskId` | `GET /v1/tasks/:id`, `GET …/events`, `GET …/run-logs`, `GET …/artifacts`, `GET …/artifacts/:artifactId`, `POST …/signals` (pause/resume), `POST …/cancel`, `POST …/retry` |
| `/apps`, `/apps/:appId` | `GET /v1/apps`, `GET /v1/apps/:id`, `POST /v1/apps`, `POST /v1/apps/:id/releases`, `DELETE /v1/apps/:id` |
| `/packages`, `/packages/:id` | `GET /v1/packages`, `GET /v1/packages/:id` |
| `/schedules`, `/schedules/:id` | `GET/POST /v1/schedules`, `GET/DELETE /v1/schedules/:id`, `GET …/triggers`, `POST …/pause`, `POST …/resume` |
| `/providers` | `GET/POST /v1/provider-connections`, `DELETE /v1/provider-connections/:id`, `GET/PUT /v1/run-agent/settings`, `GET /v1/provider-catalog/{status,providers,models}`, `POST /v1/provider-catalog/check-connection` |
| `/settings` | `GET /livez`, `GET /readyz` |

Not surfaced (yet): `POST /v1/tasks` (needs a pre-staged `task-input://` ref), `PUT /v1/provider-connections/:id`
(client method exists, no edit UI), `POST /v1/provider-catalog/sync` (requires the `provider-catalog-admin` role),
`POST /v1/chat/messages/:id/promotions`, `POST /v1/effects/resolutions`, `POST /v1/production/effects/:id/resolution`,
`/internal/*`.

## Import bundled example apps

`Apps → Import example app` imports one of the source packages under `platform/examples/ai-apps`
(`finance-briefing`, `github-trending`, `lifecycle-probe`). Dev and build run
`scripts/prepare-examples.mjs`, which copies the packages to `/examples/ai-apps/...`; there is no
separate import API. The browser creates the app (`POST /v1/apps`) and uploads its source files
(`POST /v1/apps/:id/releases`). Apps whose id is already registered are never overwritten. Because
app ids are soft-deleted server-side, an id that was previously deleted cannot be re-created; the
dialog reports that instead of modifying it. Add a new example to the list in `src/lib/example-apps.ts`
when adding one under `examples/ai-apps`.

## Notes

- Add provider connection opens with a **From models.dev / Manual** toggle: the catalog mode searches the `/v1/provider-catalog` snapshot (debounced server-side `q`), auto-fills adapter (from the provider `npm` package) and base URL (model endpoint → provider `api` → known default for openai/anthropic/xai/mistral/groq/deepinfra/togetherai/cerebras/cohere), and keeps the base URL editable for proxies. `Test connection` probes `{baseUrl}/models` before creating.
- Wire types are mirrored in `src/lib/types.ts` from `@sage/app-contracts` / `@sage/task-domain` / agent-api route
  code so the browser bundle has no server-side deps; `package-ownership.json` declares `agent-web` with no `@sage/*` deps.
- SSE uses a `fetch` stream reader (not `EventSource`) so the bearer token can be sent; reconnects with backoff.
- Keyboard: `⌘/Ctrl+K` palette, `G` then `C/T/A/P/S/M/,` to navigate, `Enter` to send.
- The app is not part of the root `tsc -b` project graph (it is a bundled DOM app with `noEmit`); use the package scripts.

## Overview & mock mode

- `/overview` (default landing) — stat tiles with sparklines and charts (recharts, themed via `--chart-*` tokens) computed from sessions, session runs, tasks, schedules/triggers. Empty data renders ghost charts.
- Mock mode (dev only, read-only): open any URL with `?mock=1` (persists in localStorage, `?mock=0` or the sidebar "Exit" clears it), or start with `VITE_MOCK=1 pnpm dev`. All GETs are served from a deterministic in-memory dataset; every write is rejected client-side (`MOCK_READ_ONLY`) so agent-api is never called.

## Localization

The console ships English (source) and Simplified Chinese copy in `src/lib/locales/{en,zh-CN}.ts`; `locales.test.ts`
keeps both key sets aligned.

- **Detection** — any `zh*` browser language (`zh`, `zh-CN`, `zh-Hans`, `zh-TW`, `zh-HK`, …) renders Simplified Chinese;
  every other value — including no match or unreadable languages — renders **English** (the default).
- **`?lang=<locale>`** — temporary per-visit override (normalized with the same rules and never written to settings),
  e.g. `/overview?lang=zh-CN` on an English browser.
- **Manual switch** — Settings → Appearance → Language (Auto / English / 中文) persists in `sage.agent-web.settings`
  (`language: 'auto' | 'en' | 'zh-CN'`, default `auto`) and applies instantly without a reload; `Auto` re-reads the
  browser language on every load. The Appearance "Reset to defaults" button also returns the language to `Auto`.
- **Synced chrome** — `<html lang>` and `document.title` follow the language (`Sage Agent Console` /
  `Sage 智能体控制台`). Time display (`formatTime`, `relativeTime`, chart date axes, heatmap weekdays) uses the current
  locale, and session searches send `locale=<locale>` to `GET /v1/chat/sessions` so the server matches the same
  untitled-session fallback title (`Untitled Chat` / `未命名对话`).
- **Server errors** — `errorDisplay()` (`src/lib/error-message.ts`) resolves every rendered error through the
  registry in `src/lib/error-codes.ts`: exact `errors.<CODE>` copy → longest `errors._<FAMILY>` prefix (passthrough
  codes such as `SOURCE_*` / `PACKAGE_LOCK_*` / `KERNEL_*`) → the raw server message. Codes whose text carries
  runtime detail (rejected fields, task names, schedule ids, kernel failures) also keep that raw detail as secondary
  text. `error-codes.test.ts` keeps the registry and both dictionaries in lockstep, so a new code cannot ship
  untranslated-by-accident.

Known boundaries: server content that is not an error code stays as-is (provider/model names, catalog values, the
mock dataset, connection-probe messages, promotion reasons); unregistered error codes keep their English message.
`<option>` enum values are API values and are not translated; the console is desktop-first — the 375px evidence
viewport renders and passes axe, but layouts are tight while the sidebar is open.

Runtime evidence (manifest `platform/evidence/agent-web-i18n/ui-manifest.json`; axe-core is fetched into
`.evidence/agent-web-i18n/tools/`, it is not a repo dependency):

```bash
cd platform
AGENT_WEB_PORT=9644 corepack pnpm --filter @sage/agent-web dev &     # serves the manifest base_url
cd ..
python3 ~/.agents/skills/taskrail/scripts/ui_evidence_check.py \
  platform/evidence/agent-web-i18n/ui-manifest.json \
  --out platform/.evidence/agent-web-i18n/ui --run-id w7 \
  --axe-path platform/.evidence/agent-web-i18n/tools/axe.min.js
```

## Beautiful UI

Visual system and AI-native primitives adapted from [Beautiful UI](https://www.beautifului.dev) (shadcn registry at
`/r/registry.json`, MIT © 2026 Shane Levine — see `src/components/bui/LICENSE`). Tokens from the registry `foundation`
item live in `src/index.css`; data-driven ports of loading-state, thinking-state, tool-chips, task-rows, streaming-text,
prompt-bar/chat-composer, approval-card, records-table, insight-cards, code-block and flowchart live in `src/components/bui/`.
The registry sources are scripted demos with extra deps (liveline, glimm, shadow-plugin, iconoir), so they were ported rather
than installed verbatim.
