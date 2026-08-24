## Purpose

受信 provider 注册表：tenant 维度 provider 条目的持久化（同 provider 多条目）、服务端密封凭据的只写不读语义、条目管理 API、部署 env 引导条目，以及包运行执行边界的 reference-only 凭据解析。凭据明文只存在于进程内存，绝不进入存储、事件、日志或 API 响应。

## ADDED Requirements

### Requirement: 注册表持久化与多条目
系统 SHALL 以 tenant 为单位持久化受信 provider 条目，字段含稳定 `id`、显示名、`source`（`user` 或 `deployment-env`）、`adapterKind`、公共 HTTPS `baseUrl`、`modelId`、可选 provider/model 展示元数据、`enabled` 与审计字段。同一 tenant 的同一 provider SHALL 允许存在多个条目（如个人 key 与部署 key 并存），唯一性仅由 `id` 承担；删除条目 SHALL 级联删除其凭据密文。

#### Scenario: 同 provider 多条目并存
- **WHEN** 已认证主体为同一 provider（如 MiniMax）先后创建两个条目（不同 key、不同显示名）
- **THEN** 两个条目同时存在、互不覆盖，均可被独立选择、更新与删除

#### Scenario: 条目元数据与凭据分离
- **WHEN** 读取条目列表
- **THEN** 返回元数据与「凭据在场」布尔状态，不返回任何密文或密钥材料

### Requirement: 凭据只写不读
provider 条目凭据 SHALL 经 `SecretBackend` 密封后存入独立凭据表（含 key version），明文 SHALL NOT 出现在任何表列、事件、Temporal payload、日志、trace 或 API 响应中。凭据 SHALL 仅通过创建/更新的写通道提交（字段提交后即不可读取）；解密 SHALL 只发生在执行边界或显式连接探测的服务端代码内。主密钥缺失或后端不可用时，凭据写入与依赖凭据的解析 SHALL fail-closed，SHALL NOT 降级为明文存储。

#### Scenario: 创建条目提交 key
- **WHEN** 已认证主体 POST 条目携带 apiKey
- **THEN** 条目与密封凭据落库，响应只含元数据与凭据在场状态，不含 key

#### Scenario: 主密钥缺失时拒绝写入
- **WHEN** 服务端未配置 `SAGE_SECRET_MASTER_KEY`，主体尝试创建携带 apiKey 的条目
- **THEN** 请求以稳定错误拒绝（不落任何明文），既有条目不受影响

#### Scenario: 密文泄露面
- **WHEN** 凭据已存储后检查存储、事件、日志与 API 响应
- **THEN** 只有密文与 key version 存在，明文与主密钥不出现在任何上述位置

### Requirement: 条目管理 API
系统 SHALL 提供 authenticated 条目 API：`GET /v1/provider-connections` 列表、`POST /v1/provider-connections` 创建、`PUT /v1/provider-connections/:id` 更新（可轮换 key）、`DELETE /v1/provider-connections/:id` 删除。baseUrl SHALL 复用公共 HTTPS 端点校验（拒绝内网/localhost/非 HTTPS），`adapterKind` 与 `modelId` 非空校验；被运行 agent 设置引用的条目 SHALL NOT 可删除（409 稳定错误），先解除引用。

#### Scenario: 创建校验
- **WHEN** POST 携带非 HTTPS 或内网 baseUrl、空 modelId、或未知字段
- **THEN** 请求被拒绝（稳定错误码），不产生条目

#### Scenario: 引用中条目不可删除
- **WHEN** 运行 agent 设置 `providerConnectionId` 指向条目 A，主体 DELETE A
- **THEN** 响应 409 稳定错误，条目保留；解除引用后删除成功并级联清除凭据

#### Scenario: 轮换 key
- **WHEN** 已认证主体 PUT 条目携带新 apiKey
- **THEN** 凭据密文被替换（key version 前移），元数据不变，明文仍不可读

### Requirement: 部署 env 引导条目
agent-api 启动时 SHALL 在受信 env 存在非空 `MINIMAX_API_KEY` 时幂等 upsert 一条 `source=deployment-env` 的引导条目（固定稳定 id，adapter/baseUrl/model 按 env 覆盖或缺省值，凭据密封自 env key）；env 缺失时 SHALL NOT 创建或清空既有引导条目。引导条目 SHALL NOT 可经 API 删除或改名（409 稳定错误），凭据可被后续 env 变化在下次启动时覆盖。

#### Scenario: 带 key 启动自动注册
- **WHEN** agent-api 以非空 `MINIMAX_API_KEY` 启动
- **THEN** 注册表存在 deployment-env 条目（凭据在场），重复启动幂等不重复创建

#### Scenario: 引导条目受保护
- **WHEN** 已认证主体尝试 DELETE 或改名 deployment-env 条目
- **THEN** 响应 409 稳定错误，条目保持

### Requirement: 执行边界 reference-only 解析
包运行在 connection 模式下，agent-worker SHALL 在 slice 执行边界从注册表解析条目并解密凭据构造执行路由；解析结果中凭据 SHALL 只留在进程内存，事件、checkpoint、Temporal payload 与日志 SHALL 只包含条目 `id`（reference-only）。条目缺失、停用、凭据缺失或 SecretBackend 不可用时 SHALL 以稳定错误 `PROVIDER_DEPENDENCY_MISSING` 失败，SHALL NOT 回退 echo、SHALL NOT 写 run 输出。

#### Scenario: connection 模式解析成功
- **WHEN** 设置指向启用的条目（凭据在场），包运行 slice 开始执行
- **THEN** 以该条目路由执行真实模型调用，payload/事件中只出现条目 id

#### Scenario: 条目被停用后运行
- **WHEN** 设置指向的条目被停用（enabled=false）或凭据被删除后发起包运行
- **THEN** 运行以 `PROVIDER_DEPENDENCY_MISSING` 显式失败，不执行 echo
