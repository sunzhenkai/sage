# Design: 修复 Schedule UI 认证接入缺口

## Context

现状与动机见 proposal.md。关键技术事实:

- `/v1/schedules` 七个端点的 authenticator 接线为 `serviceToken?.authenticateRequest(request)`(`platform/apps/agent-api/src/runtime.ts:275`),即只认 Bearer service token;`SAGE_SERVICE_TOKEN_HASHES` 未配置时对所有请求返回 401(fail closed),这与 pilot-gate「Pilot 链路 service token 认证」一致,应保留。
- 浏览器 → agent-web(vite dev:9612 / compose 容器内 vite preview:4173)→ agent-api 的 `/v1` 转发由 `platform/apps/agent-web/vite.config.ts` 的 `proxyOptions()` 提供,目前只做转发与 SSE flush,不注入任何凭据;compose 的 agent-web 服务未接收任何 token env。
- UI(`schedules.tsx`)加载失败时只 setError,`schedules` 保持 undefined,加载提示与错误横幅并存。
- 组件测试以 stub fetcher 运行,代理→API 真实链路无测试覆盖。

## Goals / Non-Goals

**Goals**

- 浏览器不持有凭据的前提下,让已配置 service token 的环境里 Schedule UI 完全可用(列表/详情/暂停/恢复/删除/触发历史)。
- 未配置 token 时给出诚实、可操作的失败态,而非永久加载。
- 为"代理注入"这一环建立真实链路测试。

**Non-Goals**

- 不改动 `/v1/schedules` API 契约、认证语义、审计行为(agent-api 无行为变更)。
- 不回退 schedules 链路到 stub 信任头,不为 compose 预置默认 token(见决策 2)。
- 不处理 packages/apps/runs 链路在本地模式的 stub 主体行为(既有状态,超出本 change)。
- 不引入 OIDC/动态凭据(D7 Non-Goal 延后续)。

## Decisions

### D1. 注入点:vite 代理层 `proxyReq` 事件,dev 与 preview 共用

在 `proxyOptions()` 的 `configure()` 内监听 `proxyReq`,当 `process.env.SAGE_SERVICE_TOKEN` 非空时为转发的 `/v1` 请求追加 `Authorization: Bearer <token>`;未设置时不加任何头。既有 SSE `flushHeaders()` 逻辑保留。

- 备选 1:UI 代码携带 token——违反「浏览器不持有凭据」的既定文案与 spec 场景,否决。
- 备选 2:为 agent-web 写自定义 Node 静态+代理服务器——引入新运行组件与部署差异,偏离现有 `vite preview` 容器形态,否决。
- 备选 3:vite `server.proxy[].headers` 静态配置——无法表达"env 未设置时不注入",且 preview 与 server 需重复配置,否决。

dev(9612)与 preview(4173)共用同一 `proxyOptions()`,单点实现。token 只存在于服务端进程 env,不出现在浏览器请求与构建产物中。

### D2. 配置口径:fail closed + 显式 dev token,不回退 stub

`schedules` 链路保持"未配置即拒绝、配置后仅认 Bearer"。本地开发按 `platform/docs/p8-decisions.md` D7 的既定路径配置 dev token:`.env` 中同时提供 `SAGE_SERVICE_TOKEN`(明文,供 agent-web 注入与 agent-worker 调用)与 `SAGE_SERVICE_TOKEN_HASHES`(sha256 hex,供 agent-api 校验),文档给出一行生成命令(`openssl rand -hex 32` + 哈希)。

- 备选:未配置时回退本地 stub 主体(与 `/v1/effects/resolutions` 的本地回退注释一致)——否决:运行门 spec 明确 schedule 管理链路 MUST 服务身份认证、stub 信任头 MUST NOT 提权;schedules 是五条链路中唯一真正执行强认证的一条,回退等于掏空运行门;compose 预置默认 token 属共享弱凭据,弱于显式配置。
- 代价:零配置 `docker compose up` 下 Schedule UI 不可用(401 + 明确提示)。这是有意的诚实姿态,提示文案指引配置步骤。

### D3. UI 错误态:加载/错误/成功三态分离

`schedules.tsx` 以显式状态区分首次加载、加载失败与成功:失败时错误横幅占据列表区域(不再渲染"加载中"提示);HTTP 401 / 错误码 `SCHEDULE_AUTHENTICATION_REQUIRED` 映射为专门的"service token 未配置或未认证"提示(区分于一般失败),横幅区保留刷新重试按钮。文案进 `locale.tsx` 双语词条。触发历史详情沿用同一模式(失败即错误态,不悬挂加载)。

### D4. 测试:组件错误态单测 + 真实代理链路注入集成测试

- 组件测试(`schedules.test.tsx`):401 响应 → 断言错误提示渲染且无"加载中"字样;成功响应 → 无回归。
- 集成测试(agent-web 包,vitest):程序化启动 vite dev server(`createServer`,与 preview 共用 `proxyOptions()`,且不依赖被 gitignore 的 dist 构建产物),上游为本测试内启动的捕获头 http server。断言:env 配置 token 时上游收到正确 `Authorization: Bearer`;未配置时不带该头。这补上"stub fetcher 让真实链路断裂不可见"的盲区,直接对应 spec 的「代理注入凭据后 UI 可用」「未配置 service token 时明确报错」两个场景的服务端半边。
- agent-api 侧行为不变,由既有 `schedules-api.test.ts` 覆盖。

### D5. runtime.ts 注释对齐(无行为变更)

删除/改写 `runtime.ts:248-250` 残留的空 `if (!serviceTokenRequired)` 块,以准确注释表达:未配置 → schedules fail closed(与运行门一致);配置后 → 仅认 Bearer。避免后来者误以为回退是未完成的待办。

## Risks / Trade-offs

- [token 经容器 env 暴露,能读容器 env 的主体可获取] → 本地/pilot 单机信任域内可接受;文档注明生产化时改用 secret 注入并按链路最小授权,OIDC 留后续(D7 既有 Non-Goal)。
- [代理对 `/v1` 全量注入,包括非 schedule 端点] → packages/apps/runs 的本地 stub 主体不受影响(它们不校验 Bearer),注入头只是多余但无害的头;SSE timeline 仅增静态头,不影响流式。
- [零配置环境下 UI 不可用] → 有意取舍(见 D2);提示文案 + 文档降低摩擦。
- [集成测试启动真实 vite preview,耗时高于纯单测] → 单文件、双用例,仅在 agent-web 包内运行,可接受。

## Migration Plan

无数据迁移。合并后:已配置 `SAGE_SERVICE_TOKEN`+`SAGE_SERVICE_TOKEN_HASHES` 的环境重启 compose 即全链路可用;未配置环境行为不变(401),仅 UI 提示更明确。回滚 = revert 提交,无状态残留。

## Open Questions

(无)
