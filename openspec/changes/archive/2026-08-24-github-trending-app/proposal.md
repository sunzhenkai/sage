# github-trending-app

## Why

平台目前只有 `ops-analyst` 一个示例 ai app，主题单一；新增一个「GitHub 热门项目分析」主题的 ai app，既为目录即包（directory-as-package）创作流程提供第二个参照实现，也为对外展示提供一个可讲故事的样例。配套制作一个静态 HTML 展示页（由 frontend-design skill 指导生成），用于介绍该 app 的能力、包结构与运行方式。

## What Changes

- 新增示例 ai app 源包 `platform/examples/ai-apps/github-trending/`：`app.yaml`（manifest）+ `prompts/system.md`（entry）+ `references/*.md`（≥2 篇通用资料）+ `output.schema.json`（结构化 digest 输出 schema）
- 新增 smoke 测试 `platform/packages/agent-package-release/src/github-trending.smoke.test.ts`：源包加载、编译为合法 Release、编译确定性（对齐 ops-analyst 先例）
- 新增单文件自包含 HTML 展示页 `docs/showcase/github-trending.html`：按 frontend-design skill 的设计流程（token 系统 → 自我评审 → 编码）生成，介绍 app 主题、包结构、运行链路与示例输出
- 更新 `platform/examples/ai-apps/README.md`：补 github-trending 主题条目
- 测试环境跑通：本地 agent-api（127.0.0.1:9610）登记该包，`GET /v1/apps` / web packages 视图确认可见，HTML 展示页浏览器渲染验证

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

（无 — 本 change 无 spec 增量：示例包与静态展示页均不改平台行为，`.openspec.yaml` 已设 `skip_specs: true`）

## Impact

| 仓库 | 角色 | 说明 |
|------|------|------|
| . | 必须 | `platform/examples/ai-apps/github-trending/`（新增）、`docs/showcase/`（新增）、smoke 测试（新增）、examples README（更新） |

不涉及平台代码（agent-api / agent-worker / agent-web）与 spec 变更。

## Non-goals

- 不改任何平台代码与规格；app 不含可执行脚本/工具/Secret（对齐源包安全边界）
- 不做 GitHub 实时数据抓取：app 是纯声明式提示词包，分析对象由运行时的 userInput 提供
- 不在 agent-web 内新增视图：管理面已由 packages 视图覆盖，展示页走独立静态 HTML

## 验收标准

- [x] 源包通过 package-schema 校验并可编译为合法 Release（smoke 测试通过）
- [x] `docs/showcase/github-trending.html` 单文件自包含、浏览器渲染正常（含移动端宽度）
- [x] 测试环境跑通：本地栈登记成功，`GET /v1/apps` 含 `github-trending`，web packages 视图可见并可进入详情
- [x] 内容全部为通用公开信息，无公司/内部系统信息

## 验证记录

- 新增 `examples/ai-apps/github-trending/`：`app.yaml` + `prompts/system.md` + 2 篇 references + `output.schema.json`（4 资产，通用公开领域知识）
- `npx vitest run packages/agent-package-release/src/github-trending.smoke.test.ts`：通过（加载 4 资产、编译合法 Release、compilerBuild=local-dev、编译确定性）
- 登记本地栈：`pnpm --filter @sage/agent-api register-package ../../examples/ai-apps/github-trending --api-url http://127.0.0.1:9610 --auth local-dev-auth` → `status=stored`，`releaseId=sha256:72ae2e01…`，`contentDigest=sha256:d4fbcf85…`
- API 验证：`GET /v1/apps` 含 `github-trending`（active，releaseCount=1）；`GET /v1/packages/github-trending` 返回 manifest 与 4 个资产
- web 验证：`http://127.0.0.1:9612/?view=packages&package=github-trending` 详情页正常（版本 1.0.0、entry、model route、4 资产预览带 digest）
- 展示页验证：`docs/showcase/github-trending.html` 经本地静态服务 + Playwright 打开，桌面（1440px）与移动（390px）全页截图检查通过（hero 信号带、三规则卡、目录树+JSON 终端、四步链路、命令终端均正常）；信号带琥珀格（missingData）经 DOM 断言存在
- `make typecheck` 通过；`agent-package-release` 套件中既有的 `source-loader.test.ts` fixture 枚举失败为 main 上既有问题（stash 验证与本次改动无关）
- `openspec validate --strict --type change github-trending-app` 通过
