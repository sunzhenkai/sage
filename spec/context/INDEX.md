# 上下文(context/)

## 一句话

Sage 在私有环境内为多产品(Chat、Task、未来其它)提供共享 Agent 执行内核,对外只通过 agent-api(SSE/HTTP)和 Temporal Task Queue 暴露,其它面都是内网对内协议。

## 使用者

| 角色 | 怎么用 |
|------|--------|
| 终端用户(Chat) | 通过浏览器访问 agent-web,经 agent-api 提交对话 |
| 终端用户(自动化) | 通过 HTTP/SSE 直接打 agent-api |
| 无人值守调度(P8) | Temporal Schedules 按 cron/interval 触发 occurrence,经 dispatcher → 统一准入产生 Run,无需人工在场 |
| Oncall 响应人(P8) | 接收 failure-taxonomy 映射的告警,经 `/v1/effects/resolutions` 裁决 retry/replay/terminate |
| 内部开发者 | 通过 OpenSpec change 与 pnpm task 提交变更 |
| Temporal Worker | 通过 Task Queue 与 agent-worker 连接 |
| 模型 Provider | 通过 HTTPS 出站调用模型 API,密钥由 Secret Vault 注入 |

## 邻接系统

| 邻接 | 方向 | 协议 | 责任切在哪 |
|------|------|------|------------|
| 浏览器用户 | 入 | HTTPS(SSE) | agent-api ↔ agent-web(同源或代理) |
| Model Provider | 出 | HTTPS | model-broker,Provider Catalog 选择 |
| MCP 工具后端 | 出 | stdio/HTTP | tool-runtime,Sandbox 隔离 |
| PostgreSQL | 双向 | TCP | 业务/Agent 状态,所有持久化数据 |
| Temporal Cluster | 双向 | gRPC(7233) | Task Router 选择目标 Cluster,Worker 订阅 Task Queue |
| S3 兼容 Artifact Store(MinIO) | 双向 | HTTPS | Checkpoint 与大对象,Effect Ledger 引用 |
| 内部 Secret Manager | 出 | HTTPS/SDK | secret-vault 解封密钥,运行时注入 |

## 信任边界

- agent-api、agent-worker、agent-web 默认内网部署;对外只暴露 Web/HTTP(SSE)。
- 多租户通过 `SAGE_TENANT_ID` 区分,数据按租户隔离(P8 起调度面四张表同样 FORCE RLS)。
- P8 service token:`SAGE_SERVICE_TOKEN_HASHES` 配置后,packages/apps/runs/schedules/resolutions 五条链路要求 Bearer 强认证(哈希存储 + 常量时间比较 + 可轮换),`x-authentication-id` stub 停止提权;未配置(本地开发)保持 stub 行为。
- Agent 工具执行在 Sandbox 中,出站受 egress 限制,只允许在白名单 Provider/MCP 后端;P8 包运行输入快照另受 `SAGE_PACKAGE_SNAPSHOT_EGRESS_ALLOWLIST` default-deny 白名单约束。
- Temporal Namespace 按租户/环境划分,Workflow 一旦启动固定 Cluster;Schedule 控制面由 agent-api 直连 Temporal Schedules。
- 模型 API Key、Bootstrap Provider Key、Master Key、service token 等秘密字段由 Secret Vault/环境注入;Spec 仅记录「存在」与「注入方式」,值一律 `<REDACTED>`。

## 质量属性

- 延迟:Chat 短请求 P95 < 2s(单轮、含 LLM 调用)由 SSE 流式补充体感。
- 吞吐:Worker Activity 并发由 Temporal 调度,业务侧不自行限流。
- 可用:Temporal Workflow 由 Temporal Cluster 负责重启/恢复;Agent State 写在 Postgres,Worker 重启可重放。
- 容量:Effect/Consumption Ledger 是单点 authority,容量压力写在 Postgres 分区(后续 Phase)。
- 多区域:暂不跨 Region,目标态见终版架构的 Runtime DSL。

## 安全

- 认证:agent-api 的浏览器会话鉴权由接入层负责(本期固定为本地开发);
- 鉴权:模型 Provider Key、Sandbox 凭据、Temporal Client Cert 全部由 Secret Vault 解封;
- 租户:`SAGE_TENANT_ID` 强制注入到 Postgres 连接串与 Temporal Namespace;
- 密钥:Spec 不写任何 key/secret 字面量;`.env`、compose 中的 dev key 仅作本地启动提示,已脱敏;
- 注入点:`SAGE_SECRET_MASTER_KEY`、`SAGE_BOOTSTRAP_PROVIDER_API_KEY` 等注入字段在 [surface/config.md](config.md) 列。
