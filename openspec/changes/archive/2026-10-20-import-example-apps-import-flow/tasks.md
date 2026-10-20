# Tasks

## 1. 示例资源与模块

- [x] 1.1 新增 `scripts/prepare-examples.mjs`，build/dev 前复制 `platform/examples/ai-apps` → `public/examples/ai-apps`，缺目录时报错 — 验证：运行脚本后三个 `app.yaml` 存在
- [x] 1.2 `vite.config.ts` 增加 dev/preview 从仓库示例目录读取的静态中间件（防路径穿越），并调整 `package.json` 脚本 — 验证：dev 下请求 `/examples/ai-apps/lifecycle-probe/app.yaml` 返回 200
- [x] 1.3 新增 `src/lib/example-apps.ts`（清单、文件加载、`importExampleApp` 编排）与 `example-apps.test.ts` — 验证：单测覆盖加载、首次导入、已存在、发布失败重试
- [x] 1.4 `api.apps` 增加 `create` / `uploadRelease`，补 `api.test.ts` — 验证：请求 URL 与 body 正确

## 2. UI 与文案

- [x] 2.1 应用页增加空状态与页头入口、导入对话框（选择/进度/成功/已存在/失败/查看详情），成功后刷新列表 — 验证：typecheck 通过
- [x] 2.2 中英文词典新增 `apps.import.*` 键并对齐 — 验证：locale 对齐测试通过
- [x] 2.3 README 更新应用页接口与导入说明 — 验证：文档与实际路由一致

## 3. 验收

- [x] 3.1 运行 agent-web typecheck 与 build（含 check:design），记录结果 — 验证：exit 0
- [x] 3.2 运行 agent-web lib 测试与 agent-api apps 测试，记录结果 — 验证：exit 0
- [x] 3.3 启动 dev 或 preview 检查导入对话框与静态示例资源（可用 mock/离线时记录缺口） — 验证：资源 200、页面入口可打开
