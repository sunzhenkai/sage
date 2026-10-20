# 设计：内置示例应用导入

## 背景与约束

- 应用页 `src/pages/apps.tsx` 只有 GET 列表/详情与 DELETE。
- `POST /v1/apps` body：`{appId,name,description?}`；`POST /v1/apps/:appId/releases` body：`{files: Record<string,string>}`；manifest.id 必须等于 appId。
- 浏览器 bundle 不引 `@sage/*`（package-ownership.json），故解析和复制在 Node 构建侧完成。
- 示例源包：`platform/examples/ai-apps/{finance-briefing,github-trending,lifecycle-probe}`。

## 方案

### 1. 示例资源暴露

- `vite.config.ts` 增加 dev/preview 静态中间件（仅 `serve` 阶段），把 `/examples/ai-apps/*` 映射到 `../../examples/ai-apps`，带路径穿越防护。
- `scripts/prepare-examples.mjs` 在 build 前把源目录复制到 `src/generated/examples` 或 `public/examples/ai-apps`；选择 `public` 以避免 TS 导入任意文本。
- `package.json`：`build` 前执行 `node scripts/prepare-examples.mjs`，`dev` 也一样，确保新增源文件可见；`gitignore` 忽略生成目录。

替代方案：把示例内容手工内联到 TS。否决：三份内容重复、易漂移。

### 2. 示例清单与加载

- 新增 `src/lib/example-apps.ts`：
  - `EXAMPLE_APPS`：`{appId,name,description,files:[...]}` 三个条目，仅为元数据与文件清单。
  - `loadExampleAppFiles(example)`：`fetch('/examples/ai-apps/<id>/<file>')`，校验 `response.ok` 且 `text()` 非空，返回 `Record<string,string>`。
  - 所有 fetch 并发；错误以 `EXAMPLE_LOAD_FAILED` 抛出，附相对路径。
- 单测：mock fetch，验证路径映射、失败路径、文件键不带目录前缀。

### 3. API 层

- `src/lib/api.ts` `apps` 增加：
  - `create(body: {appId,name,description?})` → `POST /v1/apps`
  - `uploadRelease(id, files)` → `POST /v1/apps/:id/releases`
- 失败时不吞错误；`error-message.ts` 已登记的错误码按现有机制展示。
- 新增测试校验 URL、body 与编码。

### 4. UI 组件

- `src/pages/apps.tsx`：
  - 抽 `ImportExampleAppDialog`，受控 `open/onOpenChange`；使用 `Dialog` + `DialogContent`。
  - 示例以单选卡片/列表呈现（RadioGroup 未现成，使用 `button` + `aria-pressed`），显示 id、名称、简介、版本依据 `app.yaml` 不解析，版本在成功结果展示。
  - 底部按钮：取消、导入。
  - 状态机：`idle → loading → importing → success | exists | error`；导入中禁用关闭以外的提交，重复导入入口禁用。
  - 成功后 `invalidateQueries(['apps'])`、`invalidateQueries(['packages'])`，显示“查看详情”按钮。
  - 空状态 `Empty` 增加 action 插槽或直接下方放按钮；页头非空时 actions 放“导入示例应用”。
- 模块拆分：导入逻辑放 `src/lib/example-apps.ts` 的 `importExampleApp(api, example, existingIds)` 纯函数？为了可测，抽 `runExampleImport({api,example,existingIds})`，返回 `{status:'imported'|'updated'|'exists',appId,release?}`；UI 只负责状态。
- 注意 `isMock()`：写请求由 api 层拒绝；UI 显示错误即可。

### 5. 本地化

- `locales/{en,zh-CN}.ts` 增加 `apps.import.*` 键：入口、标题、说明、每个示例名/简介、导入中、成功、已存在、失败、查看详情、关闭、重试。
- 示例名与描述可作为用户可读数据；id 保持原文。中英文键位对齐测试守护。

### 6. 验证

- 单测：`example-apps.test.ts`（加载、导入状态含 exists/失败）。
- `pnpm --filter @sage/agent-web typecheck`
- `pnpm --filter @sage/agent-web build`（含 check:design）
- `pnpm --filter @sage/agent-api test -- apps-api` 或根 `pnpm vitest run apps/agent-api/src/apps-api.test.ts`
- 运行态：`pnpm --filter @sage/agent-web dev` + 运行中的 agent-api；浏览器打开 `/apps?lang=zh-CN`，空态导入 `lifecycle-probe`，确认列表与详情；再次导入确认“已存在”。若服务未启动，记录未验证并给出手工脚本。

## 风险与回滚

- 复制进 public 的示例产物可能被 Caddy 缓存；构建哈希不覆盖静态示例，版本更新需重建镜像。回滚删除复制脚本、页头/空态入口和 API 方法即可。
- 生产镜像若只复制 agent-web dist，仍包含示例；若构建上下文不含 `platform/examples`，构建失败并明确报错，避免静默空示例。
- 不覆盖、不删除已有应用；导入失败留下的半成品应用需用户手动删除，UI 在失败文案中说明。

## 未决

- 是否把示例清单改为构建期自动扫描 `app.yaml`：本任务先手写三个，减少 YAML 解析依赖；新增示例需同步清单（已知边界）。
