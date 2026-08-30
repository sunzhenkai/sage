# Proposal: 修复 Schedule UI 认证接入缺口

## Why

P8 交付的定时任务管理 UI 在任何本地配置下都不可用:agent-api 的 `/v1/schedules` 链路只认 Bearer service token(符合 unattended-schedule-pilot-gate 的强认证要求),但 UI 文案承诺的"凭据由同源代理注入"从未实现——vite dev/preview 代理只做转发,compose 的 agent-web 容器也没有接收任何 token。结果是浏览器侧必然收到 401 `SCHEDULE_AUTHENTICATION_REQUIRED`;叠加 UI 在请求失败时仍渲染"正在加载定时任务…"的状态缺陷,页面表现为报错横幅 + 永久加载。组件测试全程使用 stub fetcher,这条真实链路的断裂对测试套件完全不可见。

## What Changes

- agent-web 的 `/v1` 同源代理(vite dev 与 preview)在配置了 `SAGE_SERVICE_TOKEN` 时为转发的管理请求注入 `Authorization: Bearer`,浏览器不持有凭据;未配置时不注入,保持 fail closed。
- `compose.yaml` 向 agent-web 容器传递 `SAGE_SERVICE_TOKEN`(与 agent-worker 同源 env)。
- schedules UI 请求失败时进入明确的错误态:错误横幅替代加载提示,不再出现"报错 + 永久加载"并存;未认证错误(`SCHEDULE_AUTHENTICATION_REQUIRED`)给出指向"未配置 service token"的具体提示。
- agent-api `runtime.ts` 中 schedules 链路残留的空 `if (!serviceTokenRequired)` 注释块清理为与实际 fail-closed 行为一致的说明(行为不变:未配置即拒绝,配置后仅认 Bearer)。
- 文档:本地开发使用 dev token 的配置步骤(生成 token 与 sha256 哈希、写入 `.env`)。
- 新增覆盖真实代理链路的注入集成测试(上游捕获 Authorization 头),弥补"测试绿、真机挂"的盲区。

不做的事:不将 schedules 链路回退到明文信任头 stub(pilot-gate 明确禁止);不在 compose 中预置默认 token(共享默认凭据弱于显式配置)。

## Capabilities

### New Capabilities

(无)

### Modified Capabilities

- `ai-app-schedule-plane`:在既有「Schedule API 与 UI」requirement 之外新增 requirement「Schedule UI 凭据接入与状态反馈」——service token 已配置时,同源代理代表浏览器注入凭据、UI 管理操作可用且浏览器不持有凭据;未配置/未认证时 UI 呈现显式错误态而非无限加载。

## Impact

- `platform/apps/agent-web/vite.config.ts`(代理注入逻辑,dev 与 preview 共用)、`platform/apps/agent-web/src/schedules.tsx`(错误态)、`platform/apps/agent-web/src/schedules.test.tsx`(组件测试)。
- `platform/compose.yaml`(agent-web env)。
- `platform/apps/agent-api/src/runtime.ts`(仅注释对齐,无行为变更)。
- 文档:`platform/docs/p8-decisions.md`(D7 本地 dev token 说明补全)与 README 快速开始。
- 不改 `/v1/schedules` API 契约、认证语义与审计行为;pilot-gate spec 无 delta。
