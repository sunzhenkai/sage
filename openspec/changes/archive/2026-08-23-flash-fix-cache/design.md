## Context

vite preview 由 `platform/Dockerfile` 以 `vite preview --port 4173` 提供；当前对静态资源只发 ETag/304（`sirv` `dev:true` + `etag:true`，无 `max-age`），`dist/assets/*` 文件名带内容哈希，适合 immutable 强缓存。

## Goals / Non-Goals

**Goals:**
- `/assets/*` 命中浏览器强缓存，刷新不再重复下载
- `index.html` 不缓存，发版后立即可取新入口

**Non-Goals:**
- 不换生产静态服务器（vite preview 已带 gzip/brotli）
- 不修改构建产物文件名策略（vite 默认已带哈希）

## Decisions

### D1 用 `configurePreviewServer` 精确控制，而非全局 `headers`
vite 的 `preview.headers` 会应用到所有响应（含 `index.html`），直接设 immutable 会缓存入口 HTML 导致发版不生效。方案：在 `preview.configurePreviewServer` 里给 `server.middlewares` 加一个前置中间件，仅对 `/assets/*`（且带文件扩展名、命中 `dist` 静态文件）设 `Cache-Control: public, max-age=31536000, immutable`；`index.html` 与 `/v1` 代理不设（保持 ETag/304 语义）。

### D2 守卫：只对确属构建产物目录的资源加 immutable
按 `/assets/` 前缀 + 非 `index.html` 判定，避免误伤代理路径或 SPA fallback。`/v1`（API 代理）与 SSE 路径不经过该中间件或显式跳过。

## Risks / Trade-offs

- 若未来某资源不带内容哈希（如 `public/` 静态文件），immutable 缓存会导致更新不生效——因此中间件仅匹配 `/assets/` 前缀。
- 本地 dev（`vite` server）不受影响（本 change 只动 `preview`）。
