# 配置键(surface/config.md)

所有配置键统一以 `SAGE_` 为前缀。**值、口令、连接串一律 `<REDACTED>`**。来源:`platform/compose.yaml` 与各包 `*.env` 处理。

## 部署模式

| 键 | 语义 | 默认 | 环境差 |
|----|------|------|--------|
| `SAGE_DEPLOYMENT_MODE` | `local` \| `staging` \| `prod` | `local` | 决定 Secret Vault 与 Bootstrap Provider 的启用策略 |
| `SAGE_TENANT_ID` | 租户标识,所有持久化与 Temporal Namespace 都以此切分 | `tenant-local` | prod 多租户 |

## HTTP / 运行时

| 键 | 语义 | 默认 | 环境差 |
|----|------|------|--------|
| `SAGE_HTTP_HOST` | agent-api 监听地址 | `0.0.0.0` | prod 收敛到内网 |
| `SAGE_HTTP_PORT` | agent-api 监听端口 | `9610` | 由 compose 注入 `SAGE_API_HOST_PORT` |
| `SAGE_HEALTH_HOST` | agent-worker 健康监听 | `0.0.0.0` | prod 同上 |
| `SAGE_HEALTH_PORT` | agent-worker 健康端口 | `9611` | 由 compose 注入 `SAGE_WORKER_HEALTH_HOST_PORT` |
| `SAGE_WEB_HOST_PORT` | agent-web 外部端口 | `14173` | 由 compose 注入 |
| `SAGE_API_PROXY_TARGET` | agent-web 反代目标 | `http://agent-api:9610` | prod 替换为网关地址 |

## 存储与依赖

| 键 | 语义 | 默认 | 环境差 |
|----|------|------|--------|
| `SAGE_POSTGRES_URL` | Postgres 连接串 | `postgres://sage:<REDACTED>@postgres:5432/sage` | prod 用 Secrets Manager |
| `SAGE_TEMPORAL_ADDRESS` | Temporal gRPC 地址 | `temporal:7233` | staging/prod 多 Cluster |
| `SAGE_ARTIFACT_*_PORT` | MinIO 端口 | 见 compose | prod 由对象存储厂商提供 |
| `SAGE_POSTGRES_PORT` / `SAGE_TEMPORAL_PORT` | 本地端口映射 | `15432` / `17233` | 仅 local |

## 鉴权 / Secret

| 键 | 语义 | 默认 | 环境差 |
|----|------|------|--------|
| `SAGE_SECRET_MASTER_KEY` | Secret Vault 主密钥 | `<REDACTED>` | 仅 local 写死,prod 由 KMS |
| `SAGE_BOOTSTRAP_PROVIDER_API_KEY` | 启动时注册真实 deployment-env Provider 用 Key | `<REDACTED>` | 空即不注册;prod 由 Secret 注入 |
| `SAGE_BOOTSTRAP_PROVIDER_BASE_URL` | Provider Base URL | 空 | 同上 |
| `SAGE_BOOTSTRAP_PROVIDER_MODEL` | Provider 模型 | 空 | 同上 |
| `SAGE_MODELS_DEV_LIVE_SMOKE` | live smoke 开关 | `0` | 仅 `smoke:models-dev-live` 用 |

## Feature Flag

| 键 | 默认 | 含义 |
|----|------|------|
| `SAGE_PRODUCTION_GOVERNANCE_ENABLED` | `1`(local) | 启用 Production Governance 边界检查;`0` 则跳过 |
| `SAGE_EFFECT_LEDGER_REQUIRED` | `1` | Effect Ledger 缺则 Run 拒绝 |

## 模型与目录

详见 `platform/packages/provider-catalog` 与 `platform/packages/context-resolver`,运行时按部署模式与租户解析。
