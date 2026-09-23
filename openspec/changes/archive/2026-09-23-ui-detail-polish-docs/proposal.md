## Why

当前 UI 文档已经完成一轮目标视觉迁移，但历史 `ui-check.md` 与约束评审明确指出文档权威、Avoid 适用范围、历史 prompt/README/layout 状态仍可能互相冲突；若不结合当前审查重新核对，后续修复会继续把历史报告或旧 prompt 当成有效规范。

## What Changes

- 只处理当前 Cursor Grok 4.7 报告中归入 docs slice 的文档 finding：功能/结构/目标视觉/运行时 token/历史参考的权威边界、状态标记、死链、Avoid 适用范围和 README/索引一致性。
- 对当前 finding 做逐条 source/evidence 处置：修复、接受、延迟或拒绝，并记录理由；历史报告漂移项必须标 revalidated/rejected。
- 更新与 UI 文档职责直接相关的当前验证记录和引用，使 `ui-v1.md`、`layout-v1.md`、`design-language.md`、`target-token-map.md`、`ui-v1-frontend-prompt.md`、README、CONTEXT 和历史报告状态不互相冒充权威。
- 不改功能契约、API、领域对象、产品源码、截图工具或运行时 token 值。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

无。

## Impact

| 仓库 | 角色 | 说明 |
|------|------|------|
| . | 必须 | 修改 `docs/design/ui`、`docs/design/README.md`、`platform/apps/agent-web/README.md`、`CONTEXT.md`、历史报告状态/引用和本子 change 的 OpenSpec 产物；不修改产品源码或 API |

## 验收标准

- [x] 当前 Cursor Grok 4.7 报告中归入 docs 的每个 P0/P1 都有当前 source/evidence 处置，并已修复或逐条记录接受理由。
- [x] 文档权威、Avoid 适用范围、历史状态、索引和死链状态一致；不再把旧 prompt、历史报告或参考截图当成当前验收依据。
- [x] `ui-v1.md` 功能契约、错误语义、API、安全边界和领域术语未被文档修订改变。
- [x] 静态检索和文档引用核验通过，`check:ui-tokens`、`typecheck`、`build` 保持通过。
- [x] `openspec validate --strict --type change ui-detail-polish-docs` 通过。

## 验证记录

### 审查发现

- P0/P1：零 finding
- P2：`layout-v1.md`、`design-language.md`、`target-token-map.md` 三处到 `global.css` 的相对路径 `../../platform/...` 解析为 `docs/platform/...`（不存在），应为 `../../../platform/...`。

### 修复

| 文件 | 修法 | 验证 |
|------|------|------|
| `layout-v1.md` | `../../platform/...` → `../../../platform/...` | 链接解析 OK |
| `design-language.md` | 同上 | OK |
| `target-token-map.md` | 同上 | OK |

### P2 状态

| # | 状态 | 理由 |
|---|------|------|
| 死链 | fixed | 3 处路径修正，node fs 验证全部 OK |

### 静态核验

- `ui-v1.md` 功能语义：未修改（零 P0/P1 docs finding，无需改动功能文档）
- `CONTEXT.md` Avoid 范围：已在上轮 `ui-notion-design-docs` 中修订完毕，本轮零 finding
- 历史报告引用状态：`ui-check.md` 已在上轮标注为一次性快照，本轮工作树中处于删除状态
- 所有文档间链接：node fs 验证全部 OK

### 命令与结果

| 命令 | 退出码 |
|------|--------|
| `corepack pnpm --filter @sage/agent-web check:ui-tokens` | 0 |
| `corepack pnpm --filter @sage/agent-web typecheck` | 0 |
| `corepack pnpm --filter @sage/agent-web build` | 0 |
| `openspec validate --strict --type change ui-detail-polish-docs` | 通过 |
