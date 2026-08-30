# ai-app-schedule-plane Specification

## Purpose
把定时调度做成平台一等公民：以 SDK 无关的 Canonical Schedule 契约描述周期触发，经受信 adapter 映射到底层调度设施，每次触发都走既有 admission 链路生成新 `AgentTaskSpec`，使 AI App 可以长期、定时、可审计地无人值守运行。
## Requirements
### Requirement: Canonical Schedule 契约与 adapter 隔离
平台 SHALL 提供与调度设施 SDK 无关的 Schedule 契约，至少包含：schedule 标识、tenant、触发规则（cron 或 interval、timezone）、misfire/catch-up 策略、overlap 策略、绑定的 Release 引用与跟随策略、执行目标约束（环境/能力/隔离，与 WorkflowTargetSnapshot 约束同源）、预算账户引用与上限、状态。底层调度设施的类型（如 Temporal Schedule/Handle）MUST NOT 出现在 canonical 契约、公共 API schema 或静态边界扫描中。

#### Scenario: canonical 依赖扫描
- **WHEN** 对 canonical 契约包执行依赖边界扫描
- **THEN** 扫描不出现任何具体调度设施 SDK 类型，替换 adapter 不需要修改契约

#### Scenario: adapter 中性 conformance
- **WHEN** 以确定性 fake adapter 运行 schedule conformance 用例
- **THEN** 触发、overlap、misfire、pause/resume 语义与契约一致，不依赖真实调度设施

### Requirement: 每次触发经 admission 生成新 Spec
Schedule 的每次触发 MUST 产生唯一 occurrence 幂等键（键输入含绑定的 task 与固化参数值），并以 schedule 固化的 task 与 params 走既有包运行准入（`package-run-input-resolution` 语义：params 按声明校验并取默认值、dataSources 经受控出口获取并按 onFailure 语义处理），解析 Release、固化依赖快照、生成新的不可变 `AgentTaskSpec` 与新 attempt；同一 occurrence 重复投递 MUST 返回同一 task/spec 结果，不得重复 admission 或重复启动 run。触发链路任何依赖（registry、policy、ledger、target）不可用时 MUST fail closed 并记录失败触发，不得降级为进程内执行，也不存在任何调度专属的人工输入通道。

#### Scenario: occurrence 重放幂等
- **WHEN** 同一 occurrence 幂等键被重复投递触发
- **THEN** 系统返回同一 task/spec 引用，且调度设施侧不存在第二个 run

#### Scenario: 固化参数触发无人工输入
- **WHEN** schedule 绑定 task `digest` 与固化 params `{window: 30}`，触发时无人参与
- **THEN** 本次触发以该 task 与参数走包运行准入，dataSources 按声明获取并注入，输入闭环不依赖任何运行时人工输入

#### Scenario: 触发依赖不可用
- **WHEN** 触发发生时 admission 依赖的 registry 或 ledger 不可用
- **THEN** 本次触发记为 failed trigger 并告警，不创建 run，不绕过 admission

### Requirement: Schedule 与 Release 绑定语义
Schedule MUST 声明完整运行绑定：目标 Release 绑定策略（固定 digest FIXED / 跟随 rollout policy FOLLOW）、绑定的 task 名与固化 params。创建/更新 schedule 时 MUST 按当时 Release 校验绑定（同名 task 存在于 manifest、params 按其 inputs 声明合法），校验失败拒绝创建。FIXED 绑定下，后续触发 MUST 持续使用创建时固化的 release digest；FOLLOW 绑定下，每次触发在 admission 时解析当前 policy 允许的 Release，且解析结果固化进该次触发的 Spec。已启动 run 的行为不因绑定策略变化而漂移。FOLLOW 解析出的新 Release 不含同名 task 或固化 params 不再合法时，该次触发 MUST 稳定失败并进入告警路由（错误信息指明不兼容项），MUST NOT 静默跳过或以降级输入继续。

#### Scenario: FIXED 绑定不漂移
- **WHEN** schedule 以 FIXED 绑定创建后，registry 的 active Release 更新
- **THEN** 后续触发生成的 Spec 仍引用原 digest，审计可证明未漂移

#### Scenario: FOLLOW 绑定跟随发布
- **WHEN** schedule 以 FOLLOW 绑定创建，新 Release 通过 rollout policy 成为 active
- **THEN** 之后的触发使用新 Release，之前的已启动 run 不受影响

#### Scenario: 创建时绑定校验拒绝
- **WHEN** 创建 schedule 时绑定的 task 在目标 Release manifest 中不存在，或固化 params 违反其 inputs 声明
- **THEN** 创建请求以稳定错误拒绝并列出违规项

#### Scenario: FOLLOW 新 Release 不兼容稳定失败
- **WHEN** FOLLOW 绑定的 schedule 触发时，policy 允许的新 Release 不含同名 task 或固化 params 不再合法
- **THEN** 该次触发记为 failed trigger 并告警（错误信息含不兼容项），不创建 run、不静默跳过

### Requirement: overlap 与 misfire 语义
Schedule MUST 显式声明 overlap 策略（跳过 / 允许并发 / 缓冲一次）；被 overlap 策略跳过或因 misfire 策略被判定过期的触发 MUST 记录 missed/skipped trigger 事件与指标，不得静默丢弃。补偿（catch-up）行为 MUST 由契约显式声明，默认不补偿。

#### Scenario: 上一实例未结束时按跳过策略处理
- **WHEN** 上一次触发的 run 仍在运行且 overlap 策略为跳过
- **THEN** 本次触发被跳过并记录 skipped trigger 事件，不启动新 run

#### Scenario: 错过的触发窗口
- **WHEN** 调度设施不可用导致触发窗口被错过且 misfire 策略为不补偿
- **THEN** 系统记录 missed trigger 事件与指标并保持告警可见，不在恢复后批量补偿

### Requirement: Schedule 生命周期管理与审计
认证主体 SHALL 能通过 API 创建、查看、暂停、恢复、更新和删除 schedule；所有管理操作 MUST 写入不可变审计（操作者、时间、变更内容）；暂停期间 MUST 不产生新触发；删除 schedule MUST 不影响已启动 run 的生命周期，且 MUST 级联标记后续触发取消。

#### Scenario: 暂停期间不触发
- **WHEN** schedule 被暂停且到达原定触发时间
- **THEN** 不产生触发与 run，恢复后从下一窗口继续，不补偿暂停期窗口

#### Scenario: 删除不影响在跑 run
- **WHEN** schedule 被删除时其某次触发的 run 仍在运行
- **THEN** 该 run 按原 Spec 继续至终态，删除操作与后续取消被审计记录

### Requirement: Schedule API 与 UI
平台 SHALL 提供独立的 schedule 管理端点（创建/列表/详情/暂停/恢复/删除/触发历史）与对应 Web UI（列表、详情、触发历史、状态与 next fire 时间）；模型输出、Package 声明与普通用户输入 MUST NOT 直接指定物理调度端点、namespace 或 queue，执行目标只能来自受信 target 约束经路由解析。未认证或越权租户的管理请求 MUST 被拒绝。

#### Scenario: 端到端创建与可见
- **WHEN** 认证用户通过 API 创建 schedule 并等待首个触发
- **THEN** UI 展示 schedule 状态、next fire 时间与触发历史，触发关联的 task 可从详情进入

#### Scenario: 越权访问被拒
- **WHEN** 非本租户主体请求该租户的 schedule 详情或管理操作
- **THEN** 请求被拒绝并产生安全审计事件

### Requirement: Schedule 观测与追溯
平台 SHALL 输出 schedule 维度的 succeeded/failed/skipped/missed trigger 指标，并为连续失败、missed trigger、预算拒止配置带响应路由与 runbook 注解的告警；高基数标识 MUST NOT 作为 metrics label。任一次触发 SHALL 可沿 schedule → occurrence → task → spec digest → run/receipt 完整追溯。

#### Scenario: 触发失败可告警可追溯
- **WHEN** 连续多次触发因 admission fail closed 而失败
- **THEN** 告警触发并携带 schedule 标识与 runbook 引用，且每次失败触发都可追溯到位创建的 task 或失败原因

### Requirement: Schedule UI 凭据接入与状态反馈
Schedule 管理 UI 的凭据 SHALL 由同源代理在服务端注入：浏览器 MUST NOT 持有或传输 service token 明文；代理转发 schedule 管理请求时，若平台已配置 service token 则 MUST 注入 `Authorization: Bearer` 凭据，未配置时 MUST NOT 注入任何凭据（管理请求按未认证被拒）。UI 在管理请求失败时 SHALL 呈现稳定的错误态并终止加载提示；对未认证错误 MUST 给出指向"service token 未配置或未认证"的明确提示，MUST NOT 呈现无限加载。

#### Scenario: 代理注入凭据后 UI 可用
- **WHEN** service token 已配置，用户通过 Web UI 查看定时任务列表、详情或执行暂停/恢复/删除
- **THEN** 同源代理为转发的管理请求注入 Bearer 凭据，操作成功；浏览器发出的请求与页面资源中不包含 token 明文

#### Scenario: 未配置 service token 时明确报错
- **WHEN** service token 未配置，用户打开定时任务页面
- **THEN** 管理请求按未认证被拒绝，UI 显示明确的未认证提示并终止加载状态，不出现永久加载

#### Scenario: 请求失败不再悬挂加载态
- **WHEN** schedule 管理请求失败（如上游不可用或认证失败）
- **THEN** UI 以错误提示呈现失败原因，列表区域不再保持"加载中"状态，且用户可重新发起加载

