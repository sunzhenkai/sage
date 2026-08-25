## MODIFIED Requirements

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
