## Why

页面闪屏的第二个来源是静态资源无强缓存：vite preview 对 JS/CSS 仅 ETag/304（源码确认 `dev: true` + `etag: true`、无 `max-age`），每次刷新/导航都重新下载资源，慢网下闪屏更明显。

## What Changes

- `vite.config.ts`：`preview.headers` 配置 `/assets/*`（带内容哈希）为 `public, max-age=31536000, immutable`，`index.html` 保持 `no-cache`（发版后能拿到新入口）
- 实现：`preview` 的 `configurePreviewServer` 中按 pathname 设置 `Cache-Control`，或配置 `headers` + 对 `index.html` 特殊处理；保证 `index.html` 永不缓存

## Capabilities

本 change 为纯部署/构建层优化，无用户可见行为变化。`.openspec.yaml` 已设 `skip_specs: true`。

## Impact

- `platform/apps/agent-web/vite.config.ts`：preview headers / configurePreviewServer
- 构建产物 `dist/` 不变（vite 已产出带哈希资源）
- 无运行时代码/行为变化
