# fix-check-deps-rules — Tasks

## 1. 规则与注释修正
- [x] 1.1 `package-ownership.json`：agent-api/agent-worker/p6-integration 补 `secret-vault`；agent-api 补 `tool-runtime`；新增 `secret-vault` 自身声明
- [x] 1.2 `platform-ports/src/index.ts`：注释措辞去 Temporal 令牌；agent-api 移除死依赖 harness-pi（chat-boundaries 归零）
- [x] 1.3 `tsc -b` 重建 dist 后 `check-dependencies`/`check-chat-boundaries` 及全部边界脚本 findings 归零
