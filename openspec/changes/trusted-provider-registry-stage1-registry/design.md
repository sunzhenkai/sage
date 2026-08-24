# Design — trusted-provider-registry-stage1-registry

## Context
run-agent-settings 已落地三态默认 provider + env 凭据路由；对话页 browser-local profile 正常工作但与包运行凭据互不相通。本 change 引入受信 provider 注册表作为包运行（及 S2 后的对话）统一凭据来源，env 降级为部署级引导条目。

## Goals / Non-Goals
- Goals：多条目注册表、密封凭据只写不读、settings `connection` 模式、env 引导条目、执行边界 reference-only、UI 管理面
- Non-Goals：云 Secret Manager、轮换治理、对话页接入、计费维度

## Decisions

### D1. 两表分离：元数据与凭据密文
`provider_connections`（元数据 + `credential_present` 由 join 派生）+ `provider_credentials`（`connection_id` PK、`ciphertext`、`key_version`、`updated_at`），级联删除。同 provider 多条目：仅 `id` 唯一，无 (tenant, provider) 约束。分离让"业务状态只存引用"有物理载体：条目行不含任何密钥材料。

### D2. SecretBackend 接口 + 本地 AES-256-GCM 后端（新包 `@sage/secret-vault`）
`seal(plaintext) → { ciphertext, keyVersion }` / `open(sealed) → plaintext`。本地后端用 node:crypto AES-256-GCM，主密钥 `SAGE_SECRET_MASTER_KEY`（base64, 32 字节）。后端不可用（缺 key/长度错）时 seal/open 抛稳定错误，调用方 fail-closed——存储包永不持有主密钥，只存密文。S3 将把接口治理（版本轮换、readyz 暴露）收严。

### D3. API 写通道专用 + 引用保护
`POST/PUT` 接受 `apiKey`（可选于 PUT 以支持只改元数据），任何响应只含 `credentialPresent` 布尔。DELETE：被 settings `providerConnectionId` 引用 → 409 `PROVIDER_CONNECTION_IN_USE`；`source=deployment-env` 条目 DELETE 与改名 → 409 `PROVIDER_CONNECTION_PROTECTED`（metadata 可更新 baseUrl/model？否——env 条目全部由启动引导维护，PUT 一并拒绝，仅允许启用/停用）。baseUrl 校验复用 `provider-connection.ts` 的公共 HTTPS 规则。

### D4. settings 枚举扩展而非替换
`defaultProvider` 增加 `connection`，配可空 `providerConnectionId`；`minimax/echo/auto` 语义不动（向后兼容，spec 承诺保持）。解析优先级：connection（注册表，fail-closed）> minimax（env）> echo/auto。PUT 组合校验：connection↔id 成对；指向不存在/停用条目 → 400 稳定错误（引用完整性在写入时即保证，删除时再挡一次）。

### D5. env 引导条目由 agent-api 启动幂等 upsert
固定 id `deployment-env-minimax`、source=deployment-env、凭据密封自 `MINIMAX_API_KEY`。选择 agent-api（而非 worker）是因为它持有 API 语义与 SecretBackend 装配；幂等 upsert 保证 api/worker 多实例安全。env 缺失或 master key 缺失时跳过并 WARN，不阻塞启动（部署可用性优先；此时该条目凭据可能陈旧——准入与执行检查会兜底 fail-closed）。`defaultProvider=minimax` legacy 路径不迁移、不重定向到该条目：两条路径并存，UI 引导用户选 connection。

### D6. worker 执行边界解析，reference-only
activities 在 slice 执行时按设置分派：connection → 注册表取条目 + open 密文 → 构造 LiveProviderRoute（内存内）；错误路径统一 `PROVIDER_DEPENDENCY_MISSING`（不可重试）。Temporal payload/事件只允许条目 id。legacy 路径不动。

### D7. UI：工作区 provider 面板 + 运行 Agent 下拉扩展
Providers 页新增「工作区 provider」卡：条目列表（名称、provider/model、source 徽标、凭据在场、启停、删除）+ 新建/编辑表单（复用对话框模式；apiKey 输入框写后即忘）。「运行 Agent」下拉选项 = auto / echo / 各启用条目；选中条目 → PUT connection 模式。徽章：connection 模式显示条目凭据状态；legacy minimax 保持 env 检测文案（S0 已限定作用域）。

## Risks / Trade-offs
- 主密钥丢失 = 已存凭据不可解：接受（重输 key 即可），文档写明；S3 提供 key version 演进。
- deployment-env 条目陈旧（env 变化未重启）：接受，准入/执行 fail-closed 兜底；readyz/徽章显示凭据在场而非"env 当前值"。
- api/worker 对 settings 的每 slice 现读保持不变，避免缓存不一致。

## Migration Plan
1. secret-vault 新包（无依赖方，先行）
2. task-domain 契约 + task-store-postgres 迁移 006 与实现
3. agent-api：路由、引导、settings API、准入
4. agent-worker：执行边界
5. agent-web：面板与下拉
6. 每步带测试，最后全仓回归

## Open Questions
无（多条目与计费维度已由用户决策）。
