# Proposal: unify-provider-model

## Why

平台当前并存两套 provider 体系：浏览器本地 external profile（localStorage 元数据 + sessionStorage key，仅 Chat 可用）与服务端受信 provider registry（密封凭据，包运行与 Chat 均可用）。#6 已交付完整的服务端凭据治理（SecretBackend 密封、只写不读、reference-only 解析），浏览器路径的存在理由已消失，只留下双倍的概念、UI 入口与维护成本。同时，包运行的 `echo` 离线模式让平台在无 provider 时以确定性回声"假活着"，掩盖真实依赖缺失，且其实现（LegacyPiHarness）是隔离的旧 runner 遗留物。

## What Changes

- **BREAKING** 移除浏览器本地 external provider profile 体系：ProviderProfileV2 存储、profile 编辑器、目录辅助选择 UI、连接检测 UI 消费、Chat 提交的内联 provider route 形态（含 key 的 ephemeral 下发）全部删除。存量 localStorage profile 不迁移，页面给出一次性弃用提示。
- **BREAKING** Chat 与包运行统一只经受信 provider registry（引用形态 `{ connectionId }`，服务端解析）。Chat 提交缺有效 connectionId 时以稳定错误拒绝并引导配置，不再回退本地运行时。
- **BREAKING** 移除 `run-agent-settings` 的 `echo` 档位：设置收敛为必填 `providerConnectionId`，`defaultProvider` 枚举删除；存量 legacy 取值（`echo`/`auto`/`minimax`）读取时归一为 unset。
- **BREAKING** 全局硬要求 provider：零 provider 配置时，Chat 阻止发送并引导添加工作区 provider；包运行准入直接 409 `PROVIDER_DEPENDENCY_MISSING`。平台没有 provider 即明确不可用，无任何静默兜底。
- **BREAKING** 删除 LegacyPiHarness（echo 实现）及其脚本标记（`[fail]`/`[slow]`/`[continue]`/`[pause]`/`[tokens:N]`）。测试改为 env 门控的进程内 fake LiveProviderInvoker：在 `liveClientFactory`/invoker 接缝注入，只伪造最终 HTTP 模型调用，设置→注册表解析→LiveProviderHarness 全链路保真。
- Providers 页移除「Local Pi Harness · 使用中」系统运行时面板与外部配置区；provider/model catalog API 保留不动（仍服务包 admission 解析），其 UI 消费随 profile 编辑器一并移除。
- 本地整栈 smoke test 改为 seed 工作区 provider 条目 + env 门控 fake live invoker，验证真实路由链路。

## Capabilities

### New Capabilities

（无——本变更是收敛与删除，不引入新能力。）

### Modified Capabilities

- `run-agent-settings`: 设置模型从 `defaultProvider` 枚举收敛为必填 `providerConnectionId`；echo 档位与离线模式语义删除；无设置 = 包运行准入拒绝。
- `package-run-live-provider`: provider 路由仅剩 registry 驱动一种；echo 分支与「与 env 无关的确定性本地 harness」语义删除。
- `persistent-short-chat`: provider route 仅保留引用形态且必需；内联形态与「缺失时回退本地运行时」删除，缺 route 稳定拒绝。
- `chat-user-interface`: 运行时选择器只剩工作区 provider 分组；本地 Pi 选项与 browser-local profile 选项删除；无可条目时阻止发送并引导。
- `pi-harness-adapter`: 「本地 echo harness 人类可读输出」requirement 删除；Provider-backed harness 保持不变。
- `browser-provider-profile-management`: 全部 requirements 标记 REMOVED（能力整体退役）。
- `workspace-status-presentation`: Provider 页状态呈现改为仅工作区 provider 条目可用性；Local Pi 系统运行时与 profile 完成度状态删除。
- `trusted-provider-registry`: 执行边界 requirement 中「SHALL NOT 回退 echo」措辞随 echo 删除更新；其余 registry 契约不变。
- `local-stack-smoke-verification`: smoke 流程改为 seed 工作区 provider + fake live invoker 驱动的端到端验证。

## Impact

- **agent-web**：`providers.tsx` 拆除 profile 编辑器/外部配置列表/Local Pi 面板；`chat.tsx` 运行时选择器收敛；`profiles.ts` 删除；`workspace-providers.tsx` 成为唯一 provider 管理 UI；locale keys 清理与新增（弃用提示、零 provider 引导）。
- **agent-api**：`chat-provider-route` 移除内联形态校验，仅接受 `{ connectionId }` 且必需；`run-agent-settings-api` 改为 `providerConnectionId` 必填模型；Chat 提交无有效 route 时 4xx 稳定错误。
- **agent-worker**：`activities.ts` 删除 echo 分支与 legacy harness 组装；仅 registry 解析路由，fail-closed 语义保持。
- **packages**：`harness-pi` 删除 `LegacyPiHarness`/`createExplicitLegacyPiHarness`；`local-runtime` 的 `createLocalAgentClient` 缺省组装移除（调用方显式注入 live 组装或 fake）；`app-contracts` 相关 route 类型收敛。
- **测试**：依赖脚本标记的用例迁移到 fake LiveProviderInvoker；`github-trending.smoke.test.ts` 改造；整栈 smoke 脚本 seed provider。
- **数据**：localStorage `sage.provider-profiles.*` 与 sessionStorage secrets 弃用（只读弃用提示，不迁移）；`run_agent_settings` 存量 echo 记录读取归一为 unset，无写副作用。
