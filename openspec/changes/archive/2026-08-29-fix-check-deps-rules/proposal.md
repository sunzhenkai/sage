# fix-check-deps-rules

## Why
`node scripts/check-dependencies.mjs` 在本分支长期红：14 项 findings 全部源于已提交历史变更与规则的脱节——统一 provider 模型（936907b/9cf132f）确立 agent-api/agent-worker 在准入与执行边界直连 `@sage/secret-vault`（LocalAesGcmSecretBackend 解密封装凭据），但 ownership 规则未同步；P8 契约基座（b9469ae）在 platform-ports 的注释里写下了 Temporal 字样，触发「平台端口层设施中立」源码令牌扫描。治理闸门长期红会掩盖真实回归。

## What Changes
- `package-ownership.json`：`agent-api`、`agent-worker`、`p6-integration` 的 `mayDependOn` 补 `secret-vault`（与既有架构一致：凭据只在受信服务端边界解密）；`agent-api` 补 `tool-runtime`（input-binding 子变更确立的受控出口复用边）；新增 `secret-vault` 包自身的 ownership 声明（Platform Security，无内部依赖）。
- `packages/platform-ports/src/index.ts`：Schedule Plane 注释以「调度设施」措辞替换 Temporal 字样（dist 重建后同名 finding 消失）。
- `apps/agent-api/package.json`：移除零引用的死依赖 `@sage/harness-pi`（936907b 遗留，解除 check-chat-boundaries 既有失败）。
- 本 change 无 spec 增量（skip_specs：规则与注释修正，无系统行为变化）。

## Capabilities

### New Capabilities
（无——skip_specs）

### Modified Capabilities
（无）

## Impact
- `platform/package-ownership.json`、`platform/packages/platform-ports/src/index.ts`（仅注释）。
- 验收：`node scripts/check-dependencies.mjs` 退出码 0、findings 归零；`tsc -b` 与 `pnpm lint` 不回归。
