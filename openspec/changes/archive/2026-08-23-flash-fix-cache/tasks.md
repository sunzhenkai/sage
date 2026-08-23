## 1. 缓存配置

- [x] 1.1 `vite.config.ts` 的 `preview` 增加 `configurePreviewServer`：前置中间件仅对 `/assets/*`（带扩展名、非 index.html）设 `Cache-Control: public, max-age=31536000, immutable`
- [x] 1.2 确认 `index.html` 与 `/v1` 代理（含 SSE）不被该中间件加 immutable，保持 ETag/304 语义

## 2. 验证

- [x] 2.1 `pnpm --filter @sage/agent-web build` 通过
- [x] 2.2 `vite preview` 起服后 `curl -I` 验证：`/assets/*.js` 返回 `Cache-Control: public, max-age=31536000, immutable`；`/`（index.html）无该头
- [x] 2.3 `openspec validate --strict --type change flash-fix-cache` 通过
