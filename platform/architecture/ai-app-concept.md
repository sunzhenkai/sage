# AI App 概念定义

> 本文定义「AI App 是什么」，属于概念层文档，不绑定具体实现。当前实现模型见 `app-release-run-model.md`，目标态架构见 `generic-agent-platform-final*`。

## 1. 一句话定义

**AI App 是一个「Agent 工作包」：把「让 Agent 完成一件特定工作」所需的全部内容——任务描述、脚本与工具、参考资料、输入参数、输出契约、环境需求——按固定结构打包成可版本化、自包含、可移植的制品。同一个包可被任何符合约定的 Agent 直接加载运行；Sage 负责提供运行环境（绑定 LLM Provider/Model、Skills、MCP、Plugins 等）、定时调度，并记录每次运行的状态、日志与产物。**

## 2. 固定结构

```
my-app/
├── app.yaml            # manifest：id/version/入口/输入参数/环境需求声明/输出契约/预算
├── prompts/            # 任务描述：指导 Agent 的意图、步骤与约束
├── scripts/            # 确定性脚本与工具（采集、渲染、发布等）
├── references/         # 领域资料，供 Agent 执行时查阅
└── output.schema.json  # 可选：业务产物的结构化校验
```

- `app.yaml` 是唯一的包入口与契约声明处；其余文件均从 manifest 可达。
- `prompts/` 与 `scripts/` 分工：prompt 负责需要智能的环节，脚本负责可验证的确定性环节；产物中事实与推断应可分栏、可核对。
- 结构固定，内容不限：包可以只有最小集合（manifest + prompt），也可以携带完整工具链。

## 3. 核心性质

| 性质 | 含义 |
|------|------|
| 自包含 | 运行所需内容在包内；包外依赖（数据源、模型、工具）一律显式声明，不做隐式假设 |
| 可移植 | 包只声明「需要什么」，不绑定「由谁提供」；Agent 与运行环境均可替换，同一个包能在多处运行 |
| 可版本化 | 发布后内容不可变、版本唯一；每次运行都针对一个确定版本，可复现、可审计 |
| 输入可选 | 输入参数化并带默认值，支持无输入的自闭环运行 |
| 输出显式 | 业务产物形态不限（文件、数据库写入、远端写入等），不强制文件化；每次运行必须产出可校验的运行结果文件 |
| 运行即实例 | App 是定义，Run 是一次执行；状态、日志、产物都归属 Run，调度只是触发 Run 的一种方式 |

## 4. 三方分工

| 角色 | 职责 |
|------|------|
| AI App | 定义「做什么、怎么做、产出什么」：任务意图、执行方法、输出契约、环境需求 |
| Agent | 加载包并执行：理解任务描述、调用脚本与工具、生成产物 |
| Sage | 提供运行环境与生命周期管理：绑定 Provider/Model/Skills/MCP/Plugins，触发与调度运行，记录状态、日志、产物 |

AI App 不携带具体环境配置（如某家 provider 的凭据）；Agent 不拥有包的内容；Sage 不改变包的语义。

## 5. 声明与绑定分离

可移植性与「Sage 可设置运行环境」同时成立的关键：

- **包内声明需求**：模型要求（`modelRoute`）、能力引用（`skillRefs`、`capabilityRefs`）、MCP/Plugin 需求、数据源声明（`dataSources`）。
- **运行时绑定实例**：Sage 把声明解析为具体的 Provider/Model、Skill 包、MCP 连接等，凭据由环境密封管理，不进包、不进 Git。

## 6. 生命周期：App / Release / Run

| 层 | 语义 | 关键约束 |
|----|------|----------|
| App | 唯一可变主体，持有元数据与当前草稿 | 草稿以 revision 做并发控制 |
| Release | 发布时冻结的不可变快照（版本号 + releaseId + 源文件快照） | 同一 App 下版本唯一；同版本同内容幂等，同版本不同内容拒绝 |
| Run | 一次 Release 的执行实例 | 只从 Release 发起；状态、日志、产物归属 Run |

调度以两种方式绑定版本：FIXED（锚定某个 Release，不漂移）与 FOLLOW（跟随 App 的最新 Release）。

## 7. 输出契约

输出分两层：业务产物与运行结果文件。

- **业务产物**：形态不限——生成文件、写入数据库、写入远端服务均可，不强制文件化，也不要求至少一个文件。包在 manifest 中声明产物及可选 schema；声明了 schema 的产物在物化前必须通过校验，否则本次运行按契约违约处理。产物归属 Run，可由 Sage 查询与审计。
- **运行结果文件**：每次运行必须产出，由运行环境按统一契约生成并校验，包无需额外声明。内容至少包括：运行状态、业务产物清单及位置（文件路径、数据库表、远端地址等）、失败原因（如有）。它是 Sage 记录与审计「这次运行产出了什么」的统一锚点，与业务产物形态无关。

## 8. 预算与边界

包必须携带可执行的约束，否则「跨 Agent 直接运行」会把风险一起搬运：

- 预算：maxTokens、工具调用上限、运行时长。
- 出口边界：数据源访问走受控白名单，缺省拒绝。
- 确定性边界：采集失败、无权限等异常不得被填成「健康」或 0；事实数字与状态不得被 AI 推断改写。

## 9. 与当前实现的对应

| 概念 | 当前实现 |
|------|----------|
| manifest | `app.yaml`（`schemaVersion: 2`），契约见 `packages/app-contracts` |
| 示例包 | `platform/examples/ai-apps/`（github-trending、finance-briefing、lifecycle-probe） |
| App / Release / Run | `app-release-run-model.md`；存储 `agent-release-registry`，编译 `agent-package-release`，准入 `agent-run-admission` |
| 环境绑定 | Providers 页配置 + 部署环境引导；凭据服务端密封 |
| 调度 | FIXED / FOLLOW，见 `apps/agent-api/src/schedules-api.ts` |
| 可校验运行结果文件 | `RunResult.v1`（`apps/agent-worker/src/run-result.ts`）：worker 物化点生成并按内置 schema 自检，成功随产物包产出、失败产出最小形态，`run-result.json` 为平台保留名 |

当前实现与概念的有意保留限制：技能与能力引用（`skillRefs`/`capabilityRefs`）为纯声明字段，运行时只走数据源出口；运行准入 local-only；按 App 的权限模型与 Release channel 未实现；业务产物仅文件物化一种形态（写数据库/远端待工具化 harness）。
