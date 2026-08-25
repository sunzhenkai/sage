# Tasks — github-trending-app

## 1. 源包实现

- [x] 1.1 新建 `platform/examples/ai-apps/github-trending/app.yaml`：id=`github-trending`、version 1.0.0、entry=`prompts/system.md`、modelRoute（anthropic claude-sonnet-4-5 + haiku fallback）、budgets
- [x] 1.2 编写 `prompts/system.md`：digest 生成角色定义（排名解读/亮点/趋势信号/领域总结），引用 references
- [x] 1.3 编写 `references/*.md` ≥2 篇：trending 信号解读框架、项目评估维度（通用公开知识，无内部信息）
- [x] 1.4 编写 `output.schema.json`：digest 结构（overview/repos[]/insights[]）
- [x] 1.5 新增 `platform/packages/agent-package-release/src/github-trending.smoke.test.ts`：加载/编译/确定性断言
- [x] 1.6 更新 `platform/examples/ai-apps/README.md` 补 github-trending 条目

## 2. HTML 展示页（frontend-design skill）

- [x] 2.1 按 frontend-design skill 出设计 token 系统（色板/字体/布局/签名元素）并对照 AI 默认样式自评审
- [x] 2.2 生成 `docs/showcase/github-trending.html`：单文件自包含、响应式、键盘焦点可见、respect prefers-reduced-motion
- [x] 2.3 浏览器验证：桌面与移动宽度渲染截图

## 3. 测试环境跑通

- [x] 3.1 `npx vitest run packages/agent-package-release/src/github-trending.smoke.test.ts` 通过
- [x] 3.2 本地 agent-api（9610）执行 `pnpm --filter @sage/agent-api register-package examples/ai-apps/github-trending ...` 登记成功
- [x] 3.3 `GET /v1/apps` 含 `github-trending`；web（9612）packages 视图可见并可进入详情页（浏览器确认）

## 4. 收尾

- [x] 4.1 `openspec validate --strict --type change github-trending-app` 通过
- [x] 4.2 勾选验收标准、补验证记录、归档 change
