# unattended-schedule-pilot-gate（delta）

## Purpose

定义"AI App 无人值守定时运行 Pilot"的运行资格门：真实认证、告警路由到真实响应人、生产风险显式接受、可量化的 soak 验收准则，并与既有签名 go/no-go 治理衔接；沿用诚实证据纪律——缺失的人类证据保持 UNFILLED 并阻断 GO，不伪造。

## ADDED Requirements

### Requirement: Pilot 链路 service token 认证
AI App 注册、Release 登记、运行触发与 schedule 管理链路 MUST 要求服务身份认证（service token 或同等 OIDC workload 身份）；基于可伪造明文信任头（如 `x-authentication-id`）的 stub 认证 MUST NOT 被上述链路接受为有效主体。token MUST 可轮换且验证失败 fail closed。

#### Scenario: 无凭证请求被拒
- **WHEN** 未携带有效 service token 的请求访问包注册或 schedule 管理端点
- **THEN** 请求以稳定未认证错误被拒绝，不创建任何资源

#### Scenario: stub 信任头不再提权
- **WHEN** 请求仅携带旧明文信任头而无 service token
- **THEN** pilot 链路不认可其主体身份，行为与未认证一致

### Requirement: 告警路由到真实响应人
无人值守相关的每条告警规则 MUST 配置响应路由（响应主体标识与 runbook 链接）；仅有占位路由名而无对应真实值班主体时，运行门 MUST 将该项标记为未满足，不得默认视为满足。

#### Scenario: 路由配置完整
- **WHEN** 运行门检查告警路由
- **THEN** 每条无人值守告警都有响应主体与 runbook，缺失项被显式列为 UNFILLED 并阻断 GO

### Requirement: 生产风险显式接受台账
pilot 依赖但尚未达到生产标准的风险项（如单点 PostgreSQL、调度设施单副本、本地备份策略）MUST 记录于显式风险接受台账，含风险描述、影响、缓解、接受主体与复评期限；台账存在未关闭的 UNFILLED 项时 MUST 阻断 GO，接受记录 MUST 可追溯且不可被静默清除。

#### Scenario: 缺项阻断 GO
- **WHEN** 运行门裁决时风险台账存在未接受的 UNFILLED 项
- **THEN** 门输出 NO-GO 并列出缺失项，不产生默认通过

### Requirement: Soak 验收准则与自动化等效验证
无人值守 pilot 运行门 SHALL 定义可量化 soak 验收：连续运行窗口（默认 14 天）内完成不少于下限次数（默认 100 次）的定时触发，触发成功率不低于声明阈值，零静默重复执行，注入故障清单（provider 失效、worker 重启、投影延迟、预算耗尽、schedule 暂停/恢复）中每项要么自愈要么稳定失败并告警。平台 SHALL 提供 soak harness：运行窗口与触发频次可配置，并支持以压缩时钟的自动化等效验证（含故障注入）作为工程证据。真实 14 天 soak 证据未提供时，门 MUST 将该证据项标记 UNFILLED 并阻断 GO，不得以本地短窗结果替代声明。

#### Scenario: 压缩时钟等效验证通过
- **WHEN** soak harness 以压缩时钟在集成环境完成注入故障的等效窗口运行
- **THEN** 自动化验证输出各验收维度的机器证据（触发数、成功率、零重复、故障处置），作为工程证据留存

#### Scenario: 真实 soak 证据缺失
- **WHEN** 运行门裁决时无真实窗口 soak 证据
- **THEN** soak 证据项标记 UNFILLED，门不得输出 GO

### Requirement: 与签名 go/no-go 治理衔接
无人值守 pilot 的 GO 决议 MUST 沿用既有签名 go/no-go 治理：决议 SHALL 引用 soak 证据、风险台账状态、认证与告警路由检查结果；任一前置项 UNFILLED 时 MUST 输出 NO-GO 并列明补齐路径。决议与全部引用证据 MUST 可追溯。

#### Scenario: 前置齐全输出 GO
- **WHEN** soak 证据、风险台账、认证与告警检查全部满足且评审主体完成签名
- **THEN** 门输出 GO 决议并固化证据引用，进入无人值守 pilot 运行

#### Scenario: 证据过期复评
- **WHEN** GO 后关键前置项（如告警路由）回归为不满足
- **THEN** 门状态回归并要求复评，已有决议不自动延续
