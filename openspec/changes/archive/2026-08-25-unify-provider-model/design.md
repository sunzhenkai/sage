# Design: unify-provider-model

## Context

#6 交付了完整的服务端凭据治理：`provider_connections` 注册表 + SecretBackend 密封（AES-256-GCM、key version、轮换、fail-closed）+ 执行边界 reference-only 解析。Chat 侧同时存在两套入口：浏览器本地 profile（localStorage 元数据 + sessionStorage key，内联形态随单次 Run 下发）与注册表引用形态（`{ connectionId }`）。包运行侧 `run_agent_settings.defaultProvider` 仍有 `echo` 档位，由 `LegacyPiHarness`（隔离旧 runner、脚本标记驱动）承担。本变更把两条路径收敛为一条，并删除 echo。见 proposal.md「Why」。

## Goals / Non-Goals

**Goals:**
- provider 配置与凭据只有一条链路：工作区 provider 注册表 → 引用解析 → LiveProviderHarness。
- 零 provider 是显式、诚实的不可用状态（chat 阻止发送、包运行准入 409），无静默兜底。
- 测试体系失去 echo 后仍有零外部依赖的确定性手段，且保真度更高（只伪造最终 HTTP 模型调用）。

**Non-Goals:**
- 不改 `trusted-provider-registry` 的存储/密封/引导契约（仅措辞更新）。
- 不改 provider/model catalog 的 API 与同步机制（UI 消费随 profile 编辑器移除）。
- 不为工作区 provider 表单新增目录辅助选择或连接检测（未来独立变更）。
- 不做存量浏览器 profile 数据迁移（key 本就随标签页消失，无可迁移价值）。
- 不动 Kernel/canonical 执行路径与 conformance 契约。

## Decisions

### D1: run-agent-settings API 收敛为必填 `providerConnectionId`
`defaultProvider` 枚举整体删除。PUT 只接受 `{ providerConnectionId }`；GET 返回 `providerConnectionId`（或 `unset: true`）+ 既有可用性列表。存量记录读取时归一：任何 legacy 形态（`echo`/`auto`/`minimax`、或缺 id 的 `connection`）→ unset，无写副作用（沿用既有「读取归一不写库」机制）。
*备选*：保留枚举但只允许 `connection`。否决——单值枚举是死代码，且「unset 与 connection」的语义已被 id 缺省表达。

### D2: Chat 提交仅接受 `{ connectionId }`，必需且 fail-closed
`chat-provider-route` 移除内联形态解析分支；缺 route、内联形态、解析失败分别映射稳定错误码（与既有 `PROVIDER_DEPENDENCY_MISSING` 族并列），响应附「添加工作区 provider」引导文案。用户消息持久化语义不变：route 校验失败发生在启动 Run 之前，不存在半途失败丢消息的新路径。
*备选*：缺 route 时自动选用运行 agent 设置的默认条目。否决——chat 与包运行共用同一默认会引入「改包运行设置意外改变 chat 行为」的耦合，当前每会话显式选择的模型更清晰。

### D3: echo 删除范围 = LegacyPiHarness 全部，含 `createLocalAgentClient` 缺省组装
`harness-pi` 删除 `LegacyPiHarness`、`createExplicitLegacyPiHarness` 与脚本标记；`local-runtime` 的 `createLocalAgentClient()`（echo 组装）一并删除，调用方必须显式提供 live 组装（chat 引用路由 / 包运行 factory / fake invoker）。`PiHarness`（canonical EngineAdapter）与 `LiveProviderHarness` 不动。
*备选*：保留 LegacyPiHarness 仅供测试。用户已明确否决。

### D4: 测试替身 = env 门控 fake LiveProviderInvoker，接缝在 `liveClientFactory`
`LiveProviderHarness` 的 invoker 本就是注入点；`createAgentTaskActivities` 已有 `liveClientFactory` 组装缝。新增受信开关（命名 `SAGE_FAKE_LIVE_PROVIDER`，仅在显式配置为 `true` 时生效）：worker/进程组装时以确定性 invoker 替换默认 `defaultLiveInvoker`（识别输入中的脚本标记以保留失败/慢速/取消测试能力，输出确定性回复文本）。设置→注册表解析→路由→harness 全链路保真，只有最终 HTTP 调用是假的。
*备选*：本地 mock HTTPS 端点。否决——注册表 baseUrl 校验拒绝内网/localhost（SSRF 防护，不应开洞），且用户明确要求 CI 无 mock HTTP 端点。

### D5: 浏览器端存量处理 = 一次性弃用提示，不迁移
Providers 页检测到 `sage.provider-profiles.*` 存在时展示一次性提示（「外部配置已弃用，请添加工作区 provider」），可关闭，状态记入 localStorage 标记位。sessionStorage 秘钥随标签页自然消亡，不主动清除。
*备选*：静默忽略。否决——静默消失的配置是最差的迁移体验。

### D6: UI 收敛后的 Providers 页形态
页面保留三个区块：运行 Agent 设置（select 仅列注册表条目，无离线选项）、工作区 provider 管理（唯一添加入口）、一次性弃用提示（条件展示）。移除：Local Pi 系统运行时面板、外部配置列表/编辑器/目录状态行。Chat 运行时选择器仅列工作区分组，无本地选项；无可用条目时 composer 禁用 + 引导。locale 同步清理（删除 profile/目录/echo 相关键，新增弃用与引导键）。

## Risks / Trade-offs

- [全新部署开箱即「不可用」，首次体验依赖配 key] → 引导文案直通「添加工作区 provider」表单；deployment-env 引导条目（`SAGE_BOOTSTRAP_PROVIDER_*`）让运维一条 env 预置即可点亮，兼容既有部署脚本。
- [fake live provider 是确定性执行的后门，误开在生产] → 开关显式 opt-in、`/readyz` 暴露非敏感标识（如 `providerExecution: fake`）、文档标注仅测试用途；生产 compose 不配置该变量。
- [chat 每次发送都依赖注册表条目健康，条目被删/停用会阻断会话] → 发送前 UI 按选择器数据预检并给明确错误；API 端稳定错误可区分原因；条目删除已有引用保护（409）覆盖包运行设置侧。
- [大量测试依赖脚本标记，迁移工作量集中] → fake invoker 保留同款标记语义，断言迁移多为机械替换；tasks.md 单列迁移批次。

## Migration Plan

1. 先落服务端（settings API 收敛 + chat route 收敛 + worker echo 分支删除），此时旧 Web 仍可工作（内联形态收到稳定错误，选择器尚未更新）——单 PR 内完成更稳妥，本地单体验无需分期。
2. Web 端拆除 profile UI 与本地运行时选项，落弃用提示与零 provider 引导。
3. 测试与 smoke 迁移到 fake invoker + provider seed。
4. 回滚策略：单仓库本地部署，git revert 整个变更即可；注册表数据与既有凭据不受影响（本变更不动其 schema）。

## Open Questions

- fake invoker 的脚本标记集合是否需要比原 echo 更丰富（如流式分片模拟）——可在实现期按测试需要补充，不影响契约。
