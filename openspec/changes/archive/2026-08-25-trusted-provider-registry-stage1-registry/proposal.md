# trusted-provider-registry-stage1-registry

## Why
包运行（ai-app）的真实模型凭据目前绑定 `MINIMAX_API_KEY` 进程环境变量：配置 provider 是运维动作（改 env + 重启 agent-api 与 agent-worker），无法支持多 provider、多 key 并存，且与对话页已能正常使用的 provider 配置形成两套语言。产品目标：API key 由预设的受信 provider 提供——新增 tenant 维度「受信 provider 注册表」，凭据服务端加密存储、只写不读；运行 agent 设置升级为可指向注册表条目（`providerConnectionId`）；env 降级为启动时自动注册的部署级引导条目。用户决策：同一 provider 允许多条目（个人 key 与部署 key 并存）；暂不加计费报账维度。

## What Changes
- 新表 `provider_connections`（元数据）+ `provider_credentials`（密封凭据密文，AES-256-GCM，主密钥 `SAGE_SECRET_MASTER_KEY`）：同 tenant 同 provider 多条目，仅 id 唯一
- 新包 `@sage/secret-vault`：`SecretBackend` 接口（seal/open）+ 本地 AES-256-GCM 后端；缺主密钥时写入 fail-closed
- agent-api 新路由 `provider-connections-api.ts`：GET 列表 / POST 创建 / PUT 更新（可轮换 key）/ DELETE；apiKey 写通道专用，任何响应不回显；baseUrl 复用公共 HTTPS 校验
- env 引导：agent-api 启动时 `MINIMAX_API_KEY` 非空则幂等 upsert `source=deployment-env` 条目（固定 id，不可经 API 删除/改名）；`defaultProvider=minimax` 的既有 env 语义保持不变（向后兼容）
- 运行 agent设置升级：`defaultProvider` 增加 `connection` 取值 + 可空 `providerConnectionId`；准入与 worker fail-closed 检查覆盖 connection 模式（条目缺失/停用/无凭据 → `PROVIDER_DEPENDENCY_MISSING`）
- worker 执行边界：connection 模式从注册表解析路由并解密凭据，key 只留进程内存，事件/Temporal payload 只含 connection id（reference-only）
- GET `/v1/run-agent/settings` 可用性改读注册表（enabled 且凭据在场的条目），legacy minimax 仍按 env 检测
- agent-web Providers 页：新增「工作区 provider」面板（列表/新建/编辑/删除/凭据在场状态）；「运行 Agent」下拉加入注册表条目；徽章按所选模式显示注册表或 env 状态

## Capabilities

### New Capabilities
- `trusted-provider-registry`: 受信 provider 条目的持久化与多条目语义、密封凭据只写不读、条目 API、env 引导条目、执行边界 reference-only 解析

### Modified Capabilities
- `run-agent-settings`: 设置记录新增 `providerConnectionId` 与 `connection` 取值；可用性解析来源改为注册表（legacy minimax 保持 env）
- `package-run-live-provider`: 执行路由叠加注册表解析——设置为 connection 时从注册表解析（fail-closed），legacy env 路径不变

## Impact
| 仓库 | 角色 | 说明 |
|------|------|------|
| platform/packages/secret-vault | 必须 | 新包：接口 + 本地后端 + 单测 |
| platform/packages/task-domain | 必须 | ProviderConnection 契约 + Store 端口 + 设置字段扩展 |
| platform/packages/task-store-postgres | 必须 | 迁移 006 + 读写实现 + 集成测试 |
| platform/apps/agent-api | 必须 | provider-connections 路由、env 引导、设置 API/准入扩展 |
| platform/apps/agent-worker | 必须 | 执行边界注册表解析 |
| platform/apps/agent-web | 必须 | 工作区 provider 面板 + 运行 Agent 下拉/徽章 |
| openspec/specs | 必须 | 新能力 + 两个主 spec 修改 |

## Non-goals
- 不实现真实 Secret Manager / KMS 云后端与轮换治理（S3 范围）
- 不改对话页（S2 范围）；browser-local profile 语义不变
- 不做计费/报账维度（用户决策）
- 不做多租户运营面（沿用现有单 tenant 模型）
