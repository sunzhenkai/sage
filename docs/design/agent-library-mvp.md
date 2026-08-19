# MVP 1：通用 Agent Library

## 定位

Agent Library 是可被其他应用复用的 Agent 执行内核。它提供一致的 Agent Run、Harness 适配、上下文组装、Skill、Tool、Session 和事件模型，但不拥有宿主的身份系统、业务数据、Task Runtime 或部署基础设施。

设计阶段不绑定实现语言。实现阶段选择一种原生语言后，同语言宿主可进程内调用；不同语言宿主可通过遵循同一契约的远程 Binding 调用。

**MVP 成功定义**：普通宿主与独立 Agent Application 均通过同一 Agent 能力契约完成有界 Agent Run，Application 不直接感知 Pi 或其他 Harness API。

## 目标与非目标

### MVP 目标

- 定义语言无关的 Agent Run、Event、Outcome 和 Error 语义；
- 提供窄且可替换的 `HarnessPort`；
- 第一版只实现一个 Harness Adapter，Pi 是当前首选候选；
- 支持显式注册、可校验的 Tool；
- 将 Skill 作为一级能力，提供 Descriptor、Registry、Loader 和选择策略；
- 在每次 Tool 调用前执行宿主提供的授权 Hook；
- 支持 Context、Session、Model、Policy 和 Telemetry 等能力端口；
- 支持流式事件、deadline、取消和运行预算，保证单次 Run 有界；
- 为 Application 提供 checkpoint、result 和 artifact 引用语义。

### MVP 非目标

- 同时支持多种编程语言或多个 Harness 实现；
- HTTP Server、Web UI、Task API 和后台 Worker；
- 数据库、定时调度、Temporal 或其他 Workflow Engine；
- 用户、租户、RBAC 和管理后台；
- 数据库、向量库、Artifact Store 的产品化实现；
- 原始 Shell、数据库或内部 HTTP 等默认高权限 Tool；
- 多 Agent DAG、Handoff、复杂 Planner 或组织级策略平台；
- Sandbox 基础设施。

## 逻辑架构

```text
宿主应用
  ├─ identity / session / business data
  ├─ AgentDefinition
  ├─ Scope
  └─ Skills / Tools / Providers
           │
           ▼
┌──────────────────────────────────────────┐
│ Agent Library                            │
│                                          │
│  Agent API                               │
│    ├─ Context Assembly                   │
│    ├─ Skill Registry / Loader            │
│    ├─ Tool Registry / Authorize          │
│    ├─ Session / Checkpoint Contract      │
│    ├─ Budget / Deadline / Cancellation   │
│    └─ Event / Error Normalization        │
│                    │                     │
│                    ▼                     │
│               Harness Port               │
└────────────────────┬─────────────────────┘
                     │
           ┌─────────┼─────────┐
           ▼         ▼         ▼
       Pi Adapter  Future A  Future B
```

## 组件职责

| 组件 | MVP 职责 | 明确不负责 |
|------|----------|------------|
| `Agent` / `AgentRunner` | 驱动一次有界 Agent Run | Task 生命周期和持久重试 |
| `HarnessPort` | 统一执行、取消和能力声明 | 暴露某个框架的内部对象 |
| Harness Adapter | 将公共契约映射到一个具体 Harness | 成为 Application 的直接依赖 |
| `ContextAssembler` | 组装输入、允许的上下文和 checkpoint | 决定业务数据保留期 |
| `SkillRegistry` | 发现、解析、校验和加载 Skill | 拥有所有业务 Skill 资产 |
| `ToolRegistry` | 显式注册、参数校验和调度 Tool | 自动开放高权限能力 |
| `Authorize` | Tool 执行前允许、拒绝或请求审批 | 取代宿主 RBAC |
| `SessionPort` | 定义 Session/Checkpoint 读写语义 | 选择存储和保留策略 |
| `EventSink` | 输出版本化 AgentEvent | 持久保存 Task Timeline |

## 语言无关公共契约

以下为逻辑 Schema，不代表某种语言的类或接口：

```text
AgentRunSpec
├── run_id
├── agent_definition_ref
├── input | input_ref
├── skill_refs[]
├── tool_refs[]
├── scope
├── session_ref?
├── checkpoint_ref?
└── limits
    ├── deadline
    ├── max_turns
    ├── max_tool_calls
    ├── max_tokens?
    └── max_cost?

AgentRunOutcome
├── status: completed | paused | failed | cancelled
├── output_ref?
├── session_ref?
├── checkpoint_ref?
├── artifact_refs[]
├── pause_reason?
└── error?
```

`scope` 由宿主签发并最小化，可包含 user、tenant、conversation 和业务对象标识。Library 只将必要字段或派生物传给 Provider、Skill、Tool 和 Authorize，不建立自己的 Workspace 或权限体系。

## Harness Port

Harness 抽象保持最小：

```text
HarnessPort
├── execute(run_spec) -> event stream + outcome
├── cancel(run_id)
└── capabilities()
```

能力声明至少覆盖：

```text
HarnessCapabilities
├── streaming
├── tool_calling
├── native_skills
├── native_session_resume
├── cancellation
└── structured_output
```

Agent Library 在运行前校验 AgentDefinition 的能力要求；不满足时提前返回明确错误，不在运行中静默降级。

Pi 可作为首个 Harness Adapter，但公共契约不得出现 Pi CLI 参数、Pi Session 格式或 Pi Event 类型。未来替换 Harness 时，Agent Application 和业务 Skill/Tool 不应迁移公共 API。

## Skill 契约

Skill 分为三个层次：

```text
Skill Asset
    SKILL.md、脚本、引用资源

Skill Descriptor
    name、version、description、source、required_tools、metadata

Skill Runtime
    discover、select、authorize、load、inject
```

职责边界：

- Library 定义 `SkillDescriptor`、Registry、Loader、事件和错误；
- 宿主或 Application 提供正式 Skill 资产、可见范围和使用策略；
- Harness 原生支持 Skill 时由 Adapter 映射；
- Harness 不支持时，Library 可将 Skill 转换为受控 Context/Tool 配置；
- MVP 支持调用方显式指定 required skills，以及从受限候选集中选择 available skills；
- Agent 不能从系统全部 Skill 中任意加载未授权能力。

## Tool 与 MCP 契约

每个 Tool 至少包含稳定名称和版本、参数 Schema、风险级别、副作用属性、执行器、timeout 和可选幂等能力描述。

执行顺序固定为：

```text
参数校验 → 授权 → 执行 → 结果归一化 → AgentEvent
```

MCP 是 Tool 的一种来源，不等同于 Tool 抽象：

```text
Tool
├── Local Function Tool
├── HTTP/API Tool
├── MCP Tool Adapter
└── Controlled Execution Tool
```

Library 可提供 MCP Adapter；宿主或 Application 负责 MCP Server 配置、凭据、网络权限和业务授权。

## Session、Run 与 Checkpoint

```text
Session
  对话和 Agent 上下文的逻辑连续性

Agent Run
  一次有界执行

Checkpoint
  Run 暂停后可供后续恢复的状态引用
```

Library 定义三者的语义并生成/消费引用；宿主或 Application 负责持久化、访问控制、保留期和 Task 到 Session 的映射。具体 Harness 的内部 Session 序列化格式不得成为公共恢复协议。

## Event 契约

事件至少覆盖：

- `run.started` / `run.completed` / `run.failed` / `run.cancelled`；
- `message.delta`；
- `skill.loaded`；
- `tool.requested` / `tool.authorized` / `tool.started` / `tool.completed` / `tool.failed`；
- `checkpoint.created`；
- `run.paused`。

每个事件包含 `schema_version`、`event_id`、`run_id`、递增 `sequence`、`occurred_at` 和 payload。事件不得默认包含完整 Prompt、凭据或敏感 Tool 结果。

## 单次运行流程

```text
宿主创建 AgentRunSpec
    ↓
校验 Definition、Scope、HarnessCapabilities 和 limits
    ↓
加载允许的 Skill、Context、Session / Checkpoint
    ↓
Harness Adapter 驱动 Agent Loop
    ↓
模型请求 Tool ──> Schema 校验 ──> Authorize ──> Tool
    │                                           │
    └────────────── AgentEvent <────────────────┘
    ↓
完成，或因审批/预算/取消生成 checkpoint
    ↓
返回 AgentRunOutcome
```

## Retry 边界

Library 只负责同一次 Run 内的有界操作重试，例如模型限流、临时网络错误和明确幂等的只读 Tool。重试必须受 deadline、预算和幂等约束。

跨进程恢复、TaskAttempt、退避调度和 Task 级重试属于 Agent Application。

## 状态与故障语义

| 情况 | MVP 行为 |
|------|----------|
| 可选 Session/Memory 未配置 | 无持久记忆运行，并输出明确能力信息 |
| Authorize 未配置 | 仅允许显式标记为低风险只读的 Tool |
| Policy 不可用 | 高风险 Tool fail closed |
| Harness 能力不足 | 运行前拒绝并列出缺失能力 |
| Tool 超时 | 遵守 deadline，输出分类错误和失败事件 |
| 取消 | 停止继续发起模型/Tool 调用，返回 `cancelled` |
| 达到预算 | 生成 checkpoint，返回 `paused` |
| 副作用结果未知 | 返回 `effect_unknown`，不盲目重试 |
| Event Sink 失败 | 默认不阻塞低风险运行；强审计场景可配置 fail closed |

## Binding 策略

```text
Agent Capability Contract
├── Local Library Binding
│   └── 同语言宿主进程内调用
└── Remote Binding
    └── 不同语言宿主通过 HTTP/RPC 调用
```

MVP 只要求实现一种原生语言和 Local Binding。Remote Binding 与多语言 SDK 在出现真实跨语言宿主后再引入。

## MVP 验收标准

- 普通宿主无需部署 Agent Application 即可完成一次 Agent Run；
- Agent Application 通过同一能力契约执行 Agent Slice；
- 公共契约不暴露 Pi 或其他 Harness 专有类型；
- Tool 参数在执行前经过 Schema 校验和 Authorize；
- required skills 与受限 available skills 均有明确加载行为；
- deadline、取消、最大轮次和最大 Tool 数具有可验证路径；
- AgentEvent 可重建一次 Run 的关键时间线；
- 替换 Harness、Model、Session 或 Telemetry Adapter 不改变 Application 的 Task API；
- Library 依赖中不存在 Task、Web UI、数据库或 Workflow Engine；
- 未配置可选能力时的降级或拒绝行为明确。

## 主要取舍

- **先冻结逻辑契约，不冻结语言**：保留技术选择空间；实现前仍需确定原生语言。
- **Harness Port 保持窄接口**：降低框架绑定；不为假设中的多 Harness 重建一套 Agent Framework。
- **Skill 使用公共 Descriptor，Harness 做映射**：保留 Skill 资产；可能无法利用所有 Harness 私有特性。
- **选择有界 Run，而不是永久循环**：便于取消、预算和恢复；Application 需要管理多个 Run。
- **checkpoint 使用 opaque ref**：Library 不管理存储；跨版本恢复需要宿主定义兼容策略。

## 相关文档

- [MVP 总览](./README.md)
- [MVP 2：独立长任务 Agent Application](./long-running-agent-app-mvp.md)
- [第一版具体系统架构](./first-version-system-architecture.md)
- [第一版分阶段实施计划](./agent-mvp-v1.1-implementation-plan.md)
- [第一版运行时架构图](./first-version-system.runtime.md)
- [开放问题与决策门](./open-questions.md)


## P6 Requirements Traceability Matrix

| Agent Library MVP requirement | P6 implementation / evidence | Status |
|---|---|---|
| Application 仍经 `LocalAgentClient`/`HarnessPort` 执行 Agent Slice，不感知 Pi | `apps/agent-worker/src/activities.ts`; P4 real Worker integration; `pnpm test:p4:integration` | automated |
| Tool 授权、预算、取消、Checkpoint 语义保持 | P1/P2 unit suites plus P4 cancel/retry/checkpoint real Temporal tests; `pnpm check` and `pnpm test:p4:integration` | automated |
| `AgentEvent` 可重建 Run 关键时间线 | real bounded H1→state→H2 `TemporalTaskHistorySource.fetchHistory()` projection in `p6.e2e.test.tsx`; cursor-race adversarial unit test; idempotent `TaskProjectionEvent(kind='agent')` repair | automated real integration |
| Application 与普通宿主复用同一 Library contract | `examples/node-host` regression and P6 Worker path; `pnpm check` | automated |
| Library 不依赖 Task/UI/DB/Workflow Engine | `scripts/check-dependencies.mjs`, `scripts/check-p6-boundaries.mjs` | automated boundary |
| Artifact/Checkpoint 仅传引用，Secret 不进入事件/History | P2 security suites, P5 credential suites, P6 Artifact outage/reference tests | automated |
| deadline/cancel/turn/tool budget 保持有界 | P1/P2 contract tests and P4 Activity cancellation integration | automated |

P6 不改变 Agent Library 的职责边界；Chat promotion、Task lifecycle、Temporal reconciliation 和 UI 均留在 Application/Control Plane。上述证据是工程验证，不构成人类生产批准。
