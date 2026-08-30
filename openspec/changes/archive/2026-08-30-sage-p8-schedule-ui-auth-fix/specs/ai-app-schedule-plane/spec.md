# ai-app-schedule-plane（delta）

## ADDED Requirements

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
