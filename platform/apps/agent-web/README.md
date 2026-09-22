# @sage/agent-web

Sage 本地工作区的前端控制面空壳（project-init `frontend` 脚手架）。

## 命令

在 `platform/` 下执行（使用 workspace 的 corepack pnpm）：

```bash
corepack pnpm --filter @sage/agent-web dev        # 开发（默认 http://127.0.0.1:5173）
corepack pnpm --filter @sage/agent-web build      # typecheck + 生产构建
corepack pnpm --filter @sage/agent-web typecheck  # 仅 typecheck
corepack pnpm --filter @sage/agent-web test       # Vitest
corepack pnpm --filter @sage/agent-web lint       # oxlint
```

## Playwright（E2E）

init 不下载浏览器二进制。需要跑 E2E 时先安装浏览器，再执行：

```bash
corepack pnpm --filter @sage/agent-web exec playwright install chromium
# 另开终端启动 dev 或 preview 后：
corepack pnpm --filter @sage/agent-web exec playwright test
```

## 结构

- `src/lib/api/`：API 客户端薄封装 + Zod 契约示例
- `src/stores/`：Zustand
- `src/components/ui/`：shadcn 生成物
- `e2e/`：Playwright smoke

功能行为与 UI 规格见仓库 `docs/design/ui/ui-v1.md` 与 `docs/design/ui/ui-v1-frontend-prompt.md`。
