# agent-package-e2e-driver Design

## Context

终版架构（`docs/design/_cross/generic-agent-platform-final-architecture.md` §8/§9）已定义 `AgentPackage → Compiler → AgentPackageRelease → Admission → AgentTaskSpec → 执行` 的目标链，但 Phase 3 未落地：

- `AgentPackageRelease.v1` 仅有清单 schema（`platform/packages/agent-contracts`），无源包格式、无编译器。
- `agent-package-release` 包近乎空壳（仅 4 行 supply-chain 占位）；`agent-release-registry` 只登记/校验已编译 Release。
- `/v1/tasks` 热路径不生成 Spec，`inputRef` 仅支持 `task-input://chat/`。
- 前端（agent-web）无包管理界面。

运行基线见 `docs/design/task-lifecycle-code-map.md`。本 driver 编排子 change 补齐「源包 → 编译 → 登记 → 从包发起运行 → 前端展示管理」全链路，运行仍走 LEGACY_TEMPORAL_TASK 路径（V2 不在范围）。

## Goals / Non-Goals

**Goals:**

- 定义「目录即包」的源规范并可校验；编译为不可变 `AgentPackageRelease.v1`
- Registry + HTTP API 支撑包的登记、列表、详情
- 新增「从包发起运行」入口：生成 canonical Spec/Envelope 并复用既有 workflow 启动链
- 一个示例 ai app 包端到端跑通（注册 → 运行 → artifact 可查）
- agent-web 新增包浏览/详情/发起运行/运行与 artifact 查看

**Non-Goals（设计层）:**

- 真实签名/SBOM/OIDC 供应链（provenance 用本地确定性占位，字段语义保留）
- 包内原生代码/脚本执行、动态 include（终版架构明确排除）
- 修改既有 `POST /v1/tasks` 与 chat 流程语义；不接 DURABLE_COORDINATOR_V2
- 多 Engine/多租户配额/审批流

## Decisions

### D1 源包格式：YAML manifest + 固定目录约定，契约落 `agent-package-release` 包

```
<app-root>/
  app.yaml            # manifest: id/version/description/entry(model 路由要求、budgets、skillRefs、capabilityRefs)
  prompts/*.md        # entry prompt 与其他提示词（system.md 约定）
  references/*.md     # 参考资料资产
  output.schema.json  # 可选输出 JSON Schema
```

- YAML 对齐"人写友好"的包作者体验；加载后转 JSON 交给 TypeBox 校验（复用仓库既有栈，不引 zod/ajv 新依赖）。
- 文本资产不做模板引擎，v1 原样引用。
- 备选：纯 JSON manifest（否——手写体验差）；把 schema 放 `agent-contracts`（否——contracts 是 canonical 运行契约层，源格式属于编译域，放编译包）。

### D2 编译器输出直接复用 `AgentPackageRelease.v1`，不破坏 canonical schema

- 编译 = 目录扫描 → schema 校验 → 内容 lock（文件列表+路径+digest）→ 计算 `contentDigest`/`lockDigest`/各资产 digest → 组装 Release。
- provenance 必填字段（compiler/lock/sbom/signature/attestation）用**确定性本地占位**（如对 lock 内容再取 digest），`compilerBuild='local-dev'`；不改 `additionalProperties:false` 的 v1 schema，不新增字段。
- 备选：给 Release 加 `provenanceStrength` 字段（否——需要 reader/writer policy + fixture 登记，超出本轮；记入 Risks）。

### D3 运行入口：新资源端点 `POST /v1/packages/{packageId}/releases` 与 `POST /v1/releases/{releaseId}/runs`，不动 `/v1/tasks`

- runs 端点职责：resolve Release → 复用 `agent-run-admission` 生成 Spec（goalRef 指向包 entry prompt，skillRefs/modelRoute/bounds 来自 manifest）→ 签发 Envelope → 复用 `TrustedMultiTargetTaskController` 启 workflow。
- Spec Store 用本地组合（create-only putSpec），不引入新 authority。
- 备选：扩展 CreateTaskRequest 加 `releaseRef` 可选字段（否——旧契约 additive 演进需兼容策略登记，且"从包运行"是不同资源语义）。

### D4 包运行的输入物化：新表 + 新 inputRef scheme

- 发起运行必填 `input`（文本）。API 将「entry prompt + references 清单 + 用户输入」**组装物化**写入新表 `task_package_input`（tenant/taskId → 拼装 prompt），`inputRef = task-input://package/{tenant}/{taskId}`。
- agent-worker 新增 `PackageTaskInputResolver` 读该表；既有 `ChatTaskInputResolver` 不动。
- 备选：worker 运行时直读 registry 资产（否——workflow input schema 不可加字段传用户输入，且运行期依赖 registry 可用性；物化一次让执行只依赖 task store）。

### D5 前端：agent-web 新增 Packages 域，复用既有 task/artifact 展示

- 路由 `/packages`（列表）`/packages/:id`（详情：manifest、资产预览、release 历史、发起运行表单）；运行跳转既有 task 视图，artifact 查看复用现有组件。
- 备选：独立新 app（否——部署面翻倍，无独立诉求）。

### D6 切片拆分（子 change，均同 planning root）

| # | 子 change | 交付 | 依赖 |
|---|-----------|------|------|
| 1 | `agent-package-e2e-package-schema` | 源规范 TypeBox 契约 + 校验器 + fixtures（agent-package-release 包内） | — |
| 2 | `agent-package-e2e-compiler` | 目录→Release 编译器（含 lock/digest/占位 provenance）+ 单测 | 1 |
| 3 | `agent-package-e2e-registry-api` | registry 登记/列表/详情 HTTP 端点 + 编译登记脚本 | 2 |
| 4 | `agent-package-e2e-run-path` | runs 端点 + Spec/Envelope 生成 + input 物化表 + worker resolver + workflow 启动 + e2e 集成测试 | 3 |
| 5 | `agent-package-e2e-sample-app` | 示例 ai app 包目录（platform/examples/ai-apps/）+ 编译产物 + smoke | 2（与 3/4 并行） |
| 6 | `agent-package-e2e-web` | agent-web Packages 域（列表/详情/发起运行/运行与 artifact 查看） | 3、4 |

## Risks / Trade-offs

- [占位 provenance 让 Release 的供应链语义名存实亡] → registry 登记时记录 compilerBuild，生产门禁（production-governance）后续拒绝未登记 build；本轮仅文档化
- [物化输入把包资产复制进 task store，包更新后旧运行不可复现拼装逻辑] → 物化内容带资产 digest 清单，Release 本身不可变，可审计重建
- [agent-run-admission 的幂等机/Spec Store 在本地组合的真实持久化未验证] → run-path 切片包含对 Spec Store 的 postgres 或 in-memory 落地决策与测试
- [新端点绕过 production admission 门] → 沿用既有 local/production 模式开关，production 模式下新端点 fail closed（未接 ProductionAdmissionCoordinator 前返回 501）
- [effect ledger 只保 store 层幂等，包运行重投仍可能双执行副作用] → 沿用现状，不在本轮扩大

## Migration Plan

- 全部为增量：新包内模块、新表、新端点、新前端路由；不改既有表结构与旧端点行为。
- 回滚 = 移除新路由/前端入口；已生成 Release/Spec 数据保留只读，不影响旧链路。

## Open Questions

- 示例包的业务主题选择（不阻塞：apply 阶段任选一个通用主题即可）
- 发起运行的权限模型粒度（不阻塞：v1 沿用现有 API 鉴权层）
