## ADDED Requirements

### Requirement: 受控 Provider connection check
系统 SHALL提供 authenticated `POST /v1/provider-catalog/check-connection`，严格接受`adapterKind`、`baseUrl`、`modelId`和可选`apiKey`，拒绝未知字段、非HTTPS URL、localhost/环回/私网目标与超出长度的输入。检测 SHALL使用有界 timeout、`redirect:'error'`和对应adapter的认证header请求model-list endpoint，不读取上游response body，不持久化或记录API key。

#### Scenario: Successful connection check
- **WHEN**authenticated principal提交合法HTTPS Base URL、model metadata和当前tab API key，且Provider model-list endpoint返回2xx
- **THEN**API返回`status="connected"`、有界`checkedAt`和非敏感message，且不改变Catalog snapshot或profile metadata

#### Scenario: Unauthorized connection check
- **WHEN**Provider endpoint返回401或403
- **THEN**API返回`status="unauthorized"`和稳定非敏感message，不回显上游body或API key

#### Scenario: Network or upstream failure
- **WHEN**endpoint超时、网络失败、返回非2xx/非401/403或redirect
- **THEN**API返回`status="unavailable"`和可重试的稳定非敏感message，且检测在有界时间内结束

#### Scenario: Strict and safe request boundary
- **WHEN**请求未认证、包含未知字段、非HTTPS URL、私网目标或超长key
- **THEN**API拒绝请求，不调用上游probe，不把请求body写入持久化存储或错误响应

### Requirement: Catalog selector retains snapshot-safe metadata
Provider/Model selector SHALL继续使用active Catalog page的snapshotId/activeSince和现有snapshot conflict guard；连接检测 SHALL是独立显式动作，不得在Catalog sync、Provider选择或Model选择时自动触发。

#### Scenario: Catalog selection does not probe
- **WHEN**用户打开新增dialog、选择Provider或Model、或Catalog完成sync
- **THEN**系统只加载Catalog metadata，不发送connection-check请求，只有点击检测图标才发起probe
