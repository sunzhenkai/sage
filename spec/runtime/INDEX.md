# 运行时(runtime/)

进程、端口、依赖、启动顺序、健康检查、弹性与可观测。

## 拓扑

| 进程 / 容器 | 角色 | 端口(内) | 副本 |
|-------------|------|-----------|------|
| `postgres` | Postgres 17.6,Temporal Server DB 与业务库共用实例 | `5432` | 1(local);prod 高可用集群 |
| `temporal` | Temporalio auto-setup,Workflow/Activity 引擎 | `7233` | 1(local);prod 多实例 |
| `artifact-store` | MinIO,S3 兼容对象存储 | `9000` 数据 / `9001` 控制台 | 1(local);prod 多副本 |
| `agent-api` | Fastify HTTP/SSE,Chat/Task/Agent Packages/Runs 入口 | `9610` HTTP | 1(local);prod 多副本 |
| `agent-worker` | Node Worker,Temporal Activity 订阅 | `9611` health | 1(local);prod 多 Worker |
| `agent-web` | Vite 预览 + Node 反代 | `4173` Web | 1(local);prod 多副本 |

外部端口映射(仅 local):`15432:5432` / `17233:7233` / `19000:9000` / `19001:9001` / `9610:9610` / `9611:9611` / `14173:4173`。

## 网络与依赖

```
agent-web  ──HTTP──>  agent-api  ──SQL──>  postgres
                            │                ▲
                            │                │
                            ▼                │
                         temporal  ──SQL────┘
                            ▲
                            │ gRPC 7233
                            │
                       agent-worker  ──S3──>  artifact-store
                            │
                            ▼
                       model provider(s)
```

- agent-api → postgres、temporal、agent-worker(Task Queue);
- agent-worker → postgres、temporal、artifact-store、model provider;
- agent-web 只连 agent-api,不直连 Postgres/Temporal;
- Temporal Namespace `sage-dev`(local),prod 按 tenant × env 切;
- Task Router 根据可信 TaskType、环境、能力、隔离、数据驻留选择 Cluster;Workflow 启动后固定。

## 启动顺序

1. `postgres`(`pg_isready` 通过);
2. `temporal`(健康检查通过);
3. `artifact-store`(MinIO `/minio/health/live` 通过);
4. `agent-api` 与 `agent-worker`(依赖前三个 healthy);
5. `agent-web`(依赖 agent-api healthy)。

compose 用 `condition: service_healthy` 串接,`--wait` 强制等待。

## 健康检查

| 服务 | 路径 | 命令 |
|------|------|------|
| agent-api | `/readyz` | `fetch('http://127.0.0.1:9610/readyz')` |
| agent-worker | `/readyz` | `fetch('http://127.0.0.1:9611/readyz')` |
| agent-web | `/` | `fetch('http://127.0.0.1:4173/')` |
| postgres | `pg_isready` | 容器内置 |
| temporal | `temporal operator cluster health` | 容器内置 |
| artifact-store | `/minio/health/live` | curl |

## 故障与弹性

- Chat 短请求:Agent Library 同步执行;LLM/工具失败 → Effect Ledger 记录 → 流式返回 error 事件;
- Chat 长请求:Temporal Workflow 自带重试/超时/取消;Activity 重试由 Temporal 策略决定;
- Agent Run 幂等:`IdempotencyClaim` + `AgentEventWriterFence` 双判,避免重复 Effect;
- Checkpoint:长 Run 由 agent-state-postgres 周期写 Checkpoint,可重放;
- Worker 崩溃:Worker 重启从 Temporal 拉取历史,Agent Run 从最近 Checkpoint 续跑;
- 多区域:暂不跨 Region;目标态见终版架构。

## 可观测

- 日志:JSON 行,worker/api 输出到 stdout(由 docker compose 收集);
- 指标:`observability` 包暴露 Prometheus 指标,Worker 内部 Counter/Histogram;
- 追踪:Temporal 自带 Workflow/Activity Trace ID,关联 Agent Run `runtimeCorrelation`;
- 告警:本地无,prod 由部署环境配置;
- SLO:暂未对外公布,验收标准见 `evidence/agent-platform-final/`。
