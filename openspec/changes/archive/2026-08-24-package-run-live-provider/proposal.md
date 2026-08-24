# package-run-live-provider

## Why

本地栈的包运行链路（`POST /v1/releases/:releaseId/runs` → Temporal → agent-worker）目前只执行本地 echo harness，manifest 的 modelRoute 只是 spec 里的字符串，无法验证 ai app 的真实模型行为；同时 run 的输出文本没有任何持久化与查询通道，验收只能看到状态与引用。需要一个 local 专属、受信环境变量配置的真实 provider 执行路径（首个接入 MiniMax 中国站），让示例包 github-trending 能产出真实 digest 并可取回。

## What Changes

- agent-worker 新增受信 live provider 路由：环境变量 `MINIMAX_API_KEY` 非空时启用（`MINIMAX_BASE_URL`/`MINIMAX_MODEL` 可覆盖，默认 MiniMax 中国站 Anthropic 兼容端点），包 run 以组装输入（entry prompt + references + 用户输入）作为单轮用户消息执行真实模型调用；未配置时保持现状 echo harness（fail-open 到既有行为，key 不落日志、不持久化）
- harness 的 live provider 执行从「构造期 transcript（chat 专用）」泛化出「以本轮 run 输入作为用户消息」的包运行模式，chat 路径行为不变
- run 输出落库（Postgres 新表）并在既有 `GET /v1/tasks/:taskId/artifacts/:artifactId` 上通过 artifactResolver 返回内容；local/development 均可查询，无内容时返回引用（不报错）
- Temporal 活动 startToClose/scheduleToClose 超时从 35s/2m 放宽到 5m/6m 以容纳真实推理时长（echo 任务不受影响，startToClose 只是上限）
- 示例包 github-trending 的 manifest modelRoute 改为 `minimax-cn` / `MiniMax-M3` 并重新登记；examples README 与展示页同步

## Capabilities

### New Capabilities

- `package-run-live-provider`: 本地部署模式下包运行的真实模型 provider 执行契约——受信环境变量路由、单轮执行语义、输出可取回与 fail-open 回退

### Modified Capabilities

（无）

## Impact

| 仓库 | 角色 | 说明 |
|------|------|------|
| platform/packages/harness-pi | 必须 | LiveProviderHarness 泛化 turn-input 模式 |
| platform/packages/local-runtime | 必须 | 新增包运行 live agent client 工厂 |
| platform/apps/agent-worker | 必须 | env 受信路由 + 客户端选择 + 输出写入 |
| platform/packages/task-domain | 必须 | run 输出记录契约 + artifact 引用内容字段 |
| platform/packages/task-store-postgres | 必须 | 新表迁移与读写实现 |
| platform/apps/agent-api | 必须 | artifactResolver 装配 |
| platform/packages/temporal-workflows | 必须 | 活动超时放宽 |
| platform/examples/ai-apps/github-trending | 必须 | modelRoute 改 minimax-cn |

## Non-goals

- 不做 modelRoute → provider 凭据的通用解析（production ModelRouteResolver 蓝图不动）；凭据仍只在请求/进程内存中存在
- 不接 S3/MinIO artifact store（输出落 Postgres，属 local/development 通道）
- 不做多轮 agent loop、工具调用与 skills（live 包运行仍是单轮完成）
- 不改 chat 链路的 provider 路由语义

## 验收标准

- [x] 未配置 `MINIMAX_API_KEY` 时 worker 行为与现状一致（echo），既有测试全部通过
- [x] 配置后包 run 真实调用 MiniMax 并成功（task succeeded），输出文本可经 `GET /v1/tasks/:taskId/artifacts/:artifactId` 取回
- [x] API key 不出现在日志、事件、spec、projection 或 artifact 响应中
- [x] 单测覆盖：harness turn-input 模式、env 路由解析、run 输出读写 roundtrip、artifactResolver 无内容回退
- [x] openspec validate --strict 通过

## 验证记录

- 单测：harness-pi（turn-input 模式 2 例 + chat 默认不变）、agent-worker（env 路由 4 例：未配置 undefined / 默认路由 / base+model 覆盖 / 描述行不含 key）、run-output-resolver（命中/未命中/引用不一致+lookup 失败 3 例）、runs-api（slice 预算映射断言）；task-store-postgres run-output 集成 3 例（本地 Postgres 实跑）。全量 `pnpm test` 830 过，仅 2 个 main 既有失败（source-loader fixture 枚举、final.test preflight，stash 干净 HEAD 复现确认）；`make typecheck`、`pnpm lint` 干净
- 回退路径（无 key，echo）：发起 run → admitted → succeeded → `GET /v1/tasks/:id/artifacts/artifact-attempt-1-slice-1` 返回 `content`="已收到：# github-trending…"（组装输入完整送达）
- 首次 live run 失败定位：`effect_unknown`，时间线 10s 整——controller 默认 slice `timeoutMs=10_000` 是比活动超时更紧的截止（M3 生成 digest 实测 ~26s）。修复：runs-api 把 manifest budgets 映射进 `CreateTaskRequest.slice`（github-trending `maxDurationMs: 300000` → 300s），`TaskSliceLimits.timeoutMs` schema 上限 30s→600s
- 真实 run（MiniMax M3，`https://api.minimaxi.com/anthropic`）：探针验证 `/v1/models` 与 `/v1/messages`（M2 已下线，现役旗舰 M3）；发起 run `pkg-95628812-…` → 35s succeeded → artifact 取回 3892 字符 digest：三项目三段式解读、趋势信号落到 references 框架（star 速率比 26.6%/3.75%/191%、fork/issue 比、单贡献者风险）、missingData 标注缺 contributors 增速与外部事件来源、方向总结区分结构信号与短期噪声
- key 安全：仅存在于 worker 进程 environ（cmdline 无），启动日志只含 provider/model/baseUrl，`grep sk-cp` 于 worker 日志与 digest 内容均 0 命中；key 未写入任何存储/事件/spec
- `openspec validate --strict --type change package-run-live-provider` 通过
