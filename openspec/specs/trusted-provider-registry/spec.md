# trusted-provider-registry Specification

## Purpose

受信 provider 注册表：tenant 维度 provider 条目的持久化（同 provider 多条目）、服务端密封凭据的只写不读语义、条目管理 API、部署 env 引导条目，以及包运行执行边界的 reference-only 凭据解析。凭据明文只存在于进程内存，绝不进入存储、事件、日志或 API 响应。

## Requirements

### Requirement: 条目管理弹窗与同 provider 重复添加
工作区 provider 条目的创建与编辑 SHALL 以 modal dialog 承载：条目列表页 SHALL NOT 展开内联创建/编辑表单。弹窗提交 SHALL 复用既有条目 API（`POST /v1/provider-connections`、`PUT /v1/provider-connections/:id`）与服务端校验边界（公共 HTTPS baseUrl、字段白名单、凭据只写），任何预填或缺省 SHALL NOT 放宽服务端校验。UI SHALL 允许同一 provider 重复添加：不因已存在同 provider 条目而阻止、去重或覆盖，多次添加各自产生独立条目（独立 `id`、独立凭据、可独立编辑与删除）；条目列表 SHALL 以条目显示名结合 provider/model 元数据区分同 provider 的多个条目。

#### Scenario: 重复添加同一 provider
- **WHEN** 已认证主体在弹窗中为同一 provider 先后添加两个条目（不同 key 或不同 model）
- **THEN** 两个条目独立并存于列表，各自可被编辑、删除与选为默认，互不影响

#### Scenario: 弹窗内校验失败呈现
- **WHEN** 弹窗提交被服务端拒绝（非法 baseUrl、缺必填字段或未知字段）
- **THEN** 弹窗保持打开并呈现稳定错误信息，已填内容不丢失，条目不产生

#### Scenario: 编辑既有条目也在弹窗
- **WHEN** 用户从条目列表发起编辑
- **THEN** 编辑表单在 modal dialog 中打开并预填既有元数据（不含任何凭据值），保存走既有 PUT 契约

### Requirement: 注册表持久化与多条目
系统 SHALL 以 tenant 为单位持久化受信 provider 条目，字段含稳定 `id`、显示名、`source`（`user` 或 `deployment-env`）、`adapterKind`、公共 HTTPS `baseUrl`、`modelId`、可选 provider/model 展示元数据、`enabled` 与审计字段。同一 tenant 的同一 provider SHALL 允许存在多个条目（如个人 key 与部署 key 并存），唯一性仅由 `id` 承担；删除条目 SHALL 级联删除其凭据密文。

#### Scenario: 同 provider 多条目并存
- **WHEN** 已认证主体为同一 provider（如 MiniMax）先后创建两个条目（不同 key、不同显示名）
- **THEN** 两个条目同时存在、互不覆盖，均可被独立选择、更新与删除

#### Scenario: 条目元数据与凭据分离
- **WHEN** 读取条目列表
- **THEN** 返回元数据与「凭据在场」布尔状态，不返回任何密文或密钥材料

### Requirement: 凭据只写不读
provider 条目凭据 SHALL 经 `SecretBackend` 密封后存入独立凭据表（含 key version），明文 SHALL NOT 出现在任何表列、事件、Temporal payload、日志、trace 或 API 响应中。凭据 SHALL 仅通过创建/更新的写通道提交（字段提交后即不可读取）；解密 SHALL 只发生在执行边界或显式连接探测的服务端代码内。主密钥（`SAGE_SECRET_MASTER_KEY`）缺失、为空或非法（非 base64 的 32 字节）时，agent-api 与 agent-worker SHALL 在启动早期以稳定错误拒绝启动（fail-fast：不打开监听、不连接依赖）；运行期后端不可用时，凭据写入与依赖凭据的解析 SHALL 仍以稳定错误 fail-closed（纵深防御），SHALL NOT 降级为明文存储。密封 SHALL 记录所用的 key version；`open` SHALL 按记录的版本选取密钥，版本对应的密钥不在配置中时 SHALL fail-closed（不尝试猜测或降级）。

#### Scenario: 创建条目提交 key
- **WHEN** 已认证主体 POST 条目携带 apiKey
- **THEN** 条目与密封凭据落库，响应只含元数据与凭据在场状态，不含 key

#### Scenario: 主密钥缺失或非法时拒绝启动
- **WHEN** agent-api 或 agent-worker 在 `SAGE_SECRET_MASTER_KEY` 缺失、为空或非 base64 的 32 字节时启动
- **THEN** 启动以稳定错误 `LOCAL_RUNTIME_REQUIRES_SAGE_SECRET_MASTER_KEY` 立即失败（不打开监听、不连接存储/Temporal、不落任何明文）

#### Scenario: 后端缺席时写入仍被拒（纵深防御）
- **WHEN** 条目 API 被装配为无可用 `secretBackend`，主体尝试创建携带 apiKey 的条目
- **THEN** 请求以稳定错误拒绝（不落任何明文），既有条目不受影响

#### Scenario: 密文泄露面
- **WHEN** 凭据已存储后检查存储、事件、日志与 API 响应
- **THEN** 只有密文与 key version 存在，明文与主密钥不出现在任何上述位置

#### Scenario: 轮换后存量密文仍可解
- **WHEN** 运维把主密钥轮换为新 current，旧 key 保留在 previous 版本列表中，之后执行边界解析轮换前密封的凭据
- **THEN** 解密成功（按记录版本选旧 key），无明文落盘；条目被更新重提交 key 时 re-seal 到新版本

#### Scenario: 未知版本 fail-closed
- **WHEN** 凭据记录的 key version 对应的密钥已从配置中移除，执行边界尝试解析
- **THEN** 以稳定错误 `PROVIDER_DEPENDENCY_MISSING` 失败，不猜测密钥、不降级明文

### Requirement: SecretBackend 治理与可观测
SecretBackend SHALL 是可替换接口：本地后端（AES-256-GCM keyring）与生产 Secret Manager 实现 SHALL 可在不改调用方契约的情况下互换；替换与轮换 SHALL NOT 使明文进入持久化或观测面。agent-api 与 agent-worker SHALL 在 `/readyz` 暴露非敏感 `secretBackend` 状态（后端模式标识，如 `local-aes-gcm`，不含任何密钥材料或指纹）；主密钥缺失或非法时进程 SHALL 在启动早期以稳定错误退出（fail-fast），SHALL NOT 以降级状态进入可服务运行。

#### Scenario: 后端状态可观测
- **WHEN** 查询 agent-api 或 agent-worker `/readyz`（无论 ready 与否）
- **THEN** 响应携带 `secretBackend.mode` 非敏感标识（如 `local-aes-gcm`）；缺主密钥的进程在启动早期即失败，不会出现在可服务状态中

#### Scenario: 后端不可用时不降级
- **WHEN** SecretBackend 不可用（缺主密钥/配置错误），发生凭据写入、执行边界解析或引用形态对话解析
- **THEN** 各路径以既有稳定错误 fail-closed，不出现明文存储或明文传输

#### Scenario: 后端可替换
- **WHEN** 生产部署以 Secret Manager 实现替换本地 keyring 后端（接口契约不变）
- **THEN** 条目 API、运行 agent 设置、包运行与对话引用解析行为不变，无明文经手调用方

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
agent-api 启动时 SHALL 在受信 env 存在非空 `SAGE_BOOTSTRAP_PROVIDER_API_KEY` 时幂等 upsert 一条 `source=deployment-env` 的引导条目（固定稳定 id，不含任何 vendor 名）：`SAGE_BOOTSTRAP_PROVIDER_BASE_URL` 与 `SAGE_BOOTSTRAP_PROVIDER_MODEL` 在此场景下必填（缺失时 SHALL 跳过引导并输出 WARN，SHALL NOT 以任何 vendor 默认值兜底），adapter 由 `SAGE_BOOTSTRAP_PROVIDER_ADAPTER` 覆盖（缺省 `anthropic`），显示名由 `SAGE_BOOTSTRAP_PROVIDER_NAME` 覆盖（缺省中性名），凭据密封自 env key；引导变量缺失时 SHALL NOT 创建或清空既有引导条目。引导条目 SHALL NOT 可经 API 删除或改名（409 稳定错误），凭据可被后续 env 变化在下次启动时覆盖。系统 SHALL NOT 识别任何 vendor 专属变量（如 `MINIMAX_API_KEY`）作为引导输入。

#### Scenario: 带 key 启动自动注册
- **WHEN** agent-api 以非空 `SAGE_BOOTSTRAP_PROVIDER_API_KEY` 且 baseUrl/model 齐备启动
- **THEN** 注册表存在 deployment-env 条目（凭据在场），重复启动幂等不重复创建

#### Scenario: 缺 baseUrl 或 model 跳过引导
- **WHEN** agent-api 启动时仅配置了 API key 而缺 baseUrl 或 model
- **THEN** 引导被跳过且启动日志输出 WARN，注册表不产生条目

#### Scenario: 引导条目受保护
- **WHEN** 已认证主体尝试 DELETE 或改名 deployment-env 条目
- **THEN** 响应 409 稳定错误，条目保持

#### Scenario: vendor 变量不生效
- **WHEN** 进程 env 仅配置了 vendor 专属变量（如 `MINIMAX_API_KEY`）而未配置通用引导变量
- **THEN** 不发生任何引导注册，注册表状态不变

### Requirement: 执行边界 reference-only 解析
包运行执行时，agent-worker SHALL 在 slice 执行边界从注册表解析条目并解密凭据构造执行路由；解析结果中凭据 SHALL 只留在进程内存，事件、checkpoint、Temporal payload 与日志 SHALL 只包含条目 `id`（reference-only）。条目缺失、停用、凭据缺失或 SecretBackend 不可用时 SHALL 以稳定错误 `PROVIDER_DEPENDENCY_MISSING` 失败，SHALL NOT 回退任何本地执行路径、SHALL NOT 写 run 输出。

#### Scenario: connection 模式解析成功
- **WHEN** 运行 agent 设置指向启用的条目（凭据在场），包运行 slice 开始执行
- **THEN** 以该条目路由执行真实模型调用，payload/事件中只出现条目 id

#### Scenario: 条目被停用后运行
- **WHEN** 设置指向的条目被停用（enabled=false）或凭据被删除后发起包运行
- **THEN** 运行以 `PROVIDER_DEPENDENCY_MISSING` 显式失败，不执行任何本地兜底
