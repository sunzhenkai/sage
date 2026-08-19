## Why

Sage 目前只有已验证的架构与实施计划，尚无可重复构建的工程基线或运行时兼容性证据。后续实现依赖 Pi 与 Temporal 的真实能力结论，必须先将这些不确定性隔离并冻结。

## What Changes

- 建立 `platform/` pnpm/TypeScript monorepo、统一质量命令和依赖方向检查。
- 锁定 Node.js、pnpm、TypeScript、Pi 与 Temporal TypeScript SDK 的精确版本及许可结论。
- 以可运行 Spike 验证 Pi 的会话/事件/取消/checkpoint 能力，以及 Temporal 的 Worker bundle、确定性、mTLS、Namespace 与 Build ID 行为。
- 提供 PostgreSQL、Temporal dev 与 S3-compatible Store 的本地 Compose profile、健康检查和 Adapter/fake 边界。
- 记录 Registry、Secret、OIDC、Artifact 控制面 Owner 与待关闭决策；未关闭的 Gate 阻断后续阶段。

## Capabilities

### New Capabilities
- `engineering-foundation`: 可重复安装、构建、测试及强制 package 依赖方向的 Sage 工程基线。
- `runtime-spike-evidence`: Pi 与 Temporal 运行时选择、可运行兼容性证据及阻断结论。
- `local-development-profile`: 本地依赖服务、健康检查和可替换外部 Adapter 的开发环境。

### Modified Capabilities

- 无。

## Impact

影响新建的 `platform/` workspace、开发 Compose 配置、CI 质量命令、依赖锁文件及决策记录。它不实现 Agent Loop、Chat、Task Router、生产基础设施或任何用户产品入口。