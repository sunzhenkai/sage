# Design — package-run-live-provider

## Context

- chat 链路已有 live provider 执行（`LiveProviderHarness` + `defaultLiveInvoker`，route 随请求体、key 不落盘），但构造期绑定 transcript，是 chat 专用。
- 包运行链路：runs-api 组装输入（entry prompt + references + userInput）物化到 `task_package_input` → Temporal `AgentTaskWorkflow` → worker activity `executeAgentSlice` → `runTaskAgentPath`（legacy LocalAgentClient + echo `LegacyPiHarness`）。
- 输出现状：activity 只生成 `artifact://tasks/...` 引用，经 P6 reconciler 写 `task_artifact_reference`（引用清单可查），但内容无处存放；task-api 的 `GET /v1/tasks/:taskId/artifacts/:artifactId` 预留了 `artifactResolver` 钩子，本地未装配。
- 活动超时 35s（workflows.ts:9），真实推理（MiniMax M 系列 reasoning 模型）可能超时。

## Goals

- github-trending 包 run 用 MiniMax 中国站真实执行并取回 digest
- 凭据只存在 worker 进程内存（来自受信 env），不落任何存储/日志
- chat 路径零行为变化；未配置 env 时包运行零行为变化

## Non-Goals

- production 的 ModelRouteResolver / model broker 接线
- S3/MinIO artifact store、多轮 loop、工具与 skills

## Decisions

### D1. harness 泛化而非新类
`LiveProviderHarness` 增加可选 `systemPrompt` 与 `turnInput` 选项：`turnInput: true` 时以 `request.input`（组装后的包输入）作为唯一用户消息，忽略构造期 transcript。chat 默认值不变（不传即旧行为）。invoker 注入边界保留，单测可继续离线覆盖。

### D2. worker 受信路由：env 触发、进程级单例
`readLiveProviderRouteFromEnv()`：`MINIMAX_API_KEY` 非空 → `{ adapterKind: 'anthropic', baseUrl: MINIMAX_BASE_URL ?? 'https://api.minimaxi.com/anthropic', modelId: MINIMAX_MODEL ?? 'MiniMax-M3', apiKey }`。注意 pi-ai anthropic 走官方 SDK，SDK 会在 baseURL 后拼 `/v1/messages`，故默认值不带 `/v1` 后缀（目录里的 `.../anthropic/v1` 是给 ai-sdk 用的，二者拼接约定不同）。启用时 worker 启动日志只打印 provider/model/baseUrl，不打印 key。未配置 → `createLocalAgentClient()`（现状）。系统提示固定为中性执行指令（不含敏感信息），entry prompt 本身在用户消息里。

### D3. 输出落 Postgres task_run_output，走既有 artifact 端点
- 新表 `task_run_output`（PK `(tenant_id, task_id)`，含 artifact_ref、output、media_type、created_at），镜像 `task_package_input` 的迁移与读写模式；重复写入同键同容幂等（existing），不同容冲突（写失败不阻断已提交 slice：catch 后告警，保持 task 终态语义优先）。
- activity 在 `commitSlice` 成功、`outcome.output` 非空后写入（经 activities options 新增 `outputStore?: TaskRunOutputStore`，worker 传入同一 PostgresTaskStore）。
- `writeRunOutput` 同时幂等 upsert `task_artifact_reference`：本地 dev 栈没有常驻 `TaskProjectionReconciler` 派生引用行（实测既有空缺），不补这行则 artifact 列表恒空；reconciler 的插入本就 `ON CONFLICT DO NOTHING`，两条路径兼容。
- `TaskArtifactReference` 增加可选 `content?: string` / `encoding?: 'utf-8'`；agent-api 装配 `artifactResolver`（`createRunOutputArtifactResolver`）：按 taskId+artifactId 查 `task_run_output`，命中则返回引用+内容，未命中返回引用本体（不抛错，避免 503 语义误伤）。

### D4. 活动超时与 slice 预算适配真实推理
- `startToCloseTimeout` 35s → 5 minutes，`scheduleToCloseTimeout` 2m → 6 minutes（覆盖 5 次重试中的短退避）。echo 执行毫秒级完成不受影响；heartbeat 50ms 间隔满足 1s heartbeatTimeout。
- 实测发现 controller 默认 slice 预算 `timeoutMs=10s` 是比活动超时更紧的截止（M3 生成 digest 约 26s，首跑恰在 10s 被切断 → effect_unknown）。修复：runs-api 以 `packageRunSliceLimits` 把 manifest budgets 映射进 `CreateTaskRequest.slice`（maxDurationMs→timeoutMs，上限 300s 对齐 startToClose；maxTokens/maxToolCalls 按 schema 上限截断），无 budgets 回退默认。
- `TaskSliceLimits.timeoutMs` schema 上限 30s → 600s（CreateTaskRequest 与 ExecuteAgentSliceInput 共用该 schema；放宽是本 change 的目的所在，echo 路径不受影响）。

### D5. modelRoute 对齐现实但执行不依赖它
github-trending manifest 改 `provider: minimax-cn / model: MiniMax-M3`，使 spec 字符串与实际执行一致（可见性与 web 展示），但 worker 执行路由仍来自 env（D2）——本 change 不引入 route→凭据解析，这是 production 蓝图的边界。

## Risks / Trade-offs

- 35s→5m 放宽作用于所有任务的活动（不止 live）：startToClose 只是上限，无轮询成本；重试等待最长变 6 分钟，可接受
- output 写失败会导致「任务成功但内容缺失」：artifact 端点回退返回引用（契约允许），D3 已声明
- MiniMax 模型名随时间漂移：`MINIMAX_MODEL` 可覆盖，默认值取当前主力模型
