# Tasks: 修复 Schedule UI 认证接入缺口

## 1. 同源代理凭据注入(agent-web)

- [x] 1.1 `vite.config.ts` 的 `proxyOptions()` 增加 `proxyReq` 注入:`SAGE_SERVICE_TOKEN` 非空时为转发请求追加 `Authorization: Bearer`,未设置不注入;保留既有 SSE flush 逻辑,dev 与 preview 共用
- [x] 1.2 `compose.yaml` agent-web 服务 env 增加 `SAGE_SERVICE_TOKEN: ${SAGE_SERVICE_TOKEN:-}`

## 2. UI 错误态(schedules.tsx)

- [x] 2.1 加载/错误/成功三态分离:请求失败时错误横幅替代列表区"加载中"提示;401 / `SCHEDULE_AUTHENTICATION_REQUIRED` 显示专门的"service token 未配置或未认证"提示;触发历史详情同样不悬挂加载态;`locale.tsx` 补双语词条
- [x] 2.2 组件测试(`schedules.test.tsx`):401 响应断言错误态渲染且无加载提示;一般失败可重试;既有成功路径用例不回归

## 3. 真实链路集成测试

- [x] 3.1 agent-web 包新增注入集成测试:程序化 `vite preview` + 捕获头上游 server,断言配置 token 时上游收到正确 Bearer 头、未配置时不带 `Authorization`

## 4. 服务端注释对齐与文档

- [x] 4.1 `runtime.ts` 清理 `schedules` 注册处空 `if (!serviceTokenRequired)` 块,注释改为与实际 fail-closed 行为一致(无行为变更)
- [x] 4.2 文档:`platform/docs/p8-decisions.md` D7 补本地 dev token 完整配置步骤(token + sha256 哈希写入 `.env`、agent-web 注入说明);README 快速开始同步一句话指引

## 5. 收尾验证

- [x] 5.1 `corepack pnpm check` 回归:lint、依赖边界、严格 TS、构建全绿,997 测试通过(含本 change 新增 7 个);余 2 个失败均为与本 change 无关的存量问题(`final.test.ts`:openspec CLI 1.8.0 无法按名解析已归档依赖 change;`node-host` live provider 预算测试,环境依赖)
- [x] 5.2 手动验收:本地栈(agent-api 19610 强认证 + vite dev 14174,与 compose 同一份代理配置)实测——无凭据经代理 GET/CREATE/PAUSE/RESUME/TRIGGERS/DELETE 全链路 2xx,直连 API 401 对照,页面资源无 token 明文;未配置 token 的代理实例 401 fail closed 且页面可用。compose 路径因并行改动新增的 `@sage/secret-vault` 包未进 Docker 锁文件而暂无法构建镜像,待该包落地锁文件后可直接补跑(不影响本 change 代码路径)
