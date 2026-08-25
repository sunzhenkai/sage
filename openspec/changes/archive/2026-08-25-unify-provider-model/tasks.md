# Tasks: unify-provider-model

## 1. 测试替身先行（后续步骤的依赖）

- [x] 1.1 `harness-pi`：为 `LiveProviderInvoker` 增加确定性 fake 实现（识别 `[fail]`/`[slow]`/`[continue]`/`[pause]`/`[tokens:N]` 脚本标记，输出确定性回复），随包导出
- [x] 1.2 `agent-worker`：组装缝支持 `SAGE_FAKE_LIVE_PROVIDER=true` 时以 fake invoker 替换 `liveClientFactory` 默认组装；`/readyz` 暴露非敏感 `providerExecution` 标识
- [x] 1.3 单测覆盖：fake 开关生效/不生效两态下，设置→注册表解析→harness 路由行为符合预期

## 2. run-agent-settings 收敛（服务端）

- [x] 2.1 `task-domain`：设置读写模型改为必填 `providerConnectionId`；读取归一 legacy 形态（`echo`/`auto`/`minimax`、缺 id 的 `connection`）为 unset，无写副作用；迁移既有集成测试
- [x] 2.2 `run-agent-settings-api`：PUT 仅接受 `{ providerConnectionId }`（id 须指向存在、启用、凭据在场条目），GET 返回 id 或 unset + 可用性列表；更新 API 测试
- [x] 2.3 `runs-api` 准入：unset 或条目不可用 → 409 `PROVIDER_DEPENDENCY_MISSING`（retryable=false，附修复指引），不物化输入不建任务；删除「echo 照常准入」路径与测试

## 3. Chat 路由收敛（服务端）

- [x] 3.1 `chat-provider-route`：仅接受 `{ connectionId }` 引用形态且必需；内联形态、缺失、解析失败分别映射稳定错误码（不启动 Run、不回退本地运行时）；更新测试
- [x] 3.2 `agent-api` chat 提交链路移除本地运行时组装（`createLiveProviderAgentClient` 之外的 echo 组装调用点清理）

## 4. echo harness 删除

- [x] 4.1 `harness-pi`：删除 `LegacyPiHarness`、`createExplicitLegacyPiHarness`、脚本标记解析与相关测试
- [x] 4.2 `local-runtime`：删除 `createLocalAgentClient()` 缺省 echo 组装；调用方改为显式 live/fake 组装
- [x] 4.3 `agent-worker` activities：删除 echo 分支与本地确定性 harness 装配，仅保留注册表解析路由（fail-closed 不变）
- [x] 4.4 全仓 grep 清理 `LegacyPiHarness`/`legacyMode`/`explicit-old-runner` 残留引用

## 5. Web 端收敛

- [x] 5.1 `chat.tsx`：运行时选择器仅保留工作区 provider 分组；无可用条目或所选失效时禁用 composer 并展示引导；头部运行时标识改为所选条目或未配置状态
- [x] 5.2 `providers.tsx`：移除 Local Pi 面板、外部配置列表/编辑器、目录状态行与同步入口；`profiles.ts` 删除
- [x] 5.3 Providers 页一次性弃用提示：检测 `sage.provider-profiles.*` 存在时展示可关闭提示（localStorage 标记位）
- [x] 5.4 `locale.tsx`：清理 profile/目录/echo 相关键，新增弃用提示与零 provider 引导键（zh/en 同步）
- [x] 5.5 更新 `providers.test.tsx`/`chat.runtime.test.tsx`/`chat-recovery.test.tsx` 至新交互

## 6. 测试与 smoke 迁移

- [x] 6.1 依赖脚本标记/echo 输出的单测与集成测试迁移至 fake invoker 断言
- [x] 6.2 `github-trending.smoke.test.ts` 改造：seed 工作区 provider + 设置 + fake 开关
- [x] 6.3 `corepack pnpm smoke:local` 编排：compose 注入 fake 开关与 SecretBackend master key，流程 seed provider 后验证 chat 回复与包运行 succeeded
- [x] 6.4 全量 `typecheck` + `build` + vitest 通过

## 7. 收尾

- [x] 7.1 `platform/examples/ai-apps/README.md` 等文档更新（provider 必需、无离线模式）
- [x] 7.2 归档时执行 specs 措辞清扫：`local-application-runtime`/`web-interface-localization` 等残留的 Local Pi/profile 表述同步更新
