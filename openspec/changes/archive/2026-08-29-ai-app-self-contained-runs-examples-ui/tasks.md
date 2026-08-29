# ai-app-self-contained-runs-examples-ui — Tasks

## 1. 示例 v2

- [x] 1.1 `github-trending`：app.yaml v2（inputs window/language、dataSources GitHub Search API、tasks.trending-digest 绑定 schema/files）、提示词重写（分析注入快照、明示口径）
- [x] 1.2 `ops-analyst`：inputs 参数化（可选描述文本 + severity enum），提示词消费参数段
- [x] 1.3 `lifecycle-probe`：确定性自输入探针重写（固定自检报告，可硬编码断言）；smoke 测试更新
- [x] 1.4 `examples/ai-apps/README.md`：v2 声明、参数与数据源说明、白名单配置

## 2. 前端

- [x] 2.1 发起表单参数化：inputs 声明渲染控件 + 默认值、task 选择器、移除自由文本与空输入警告；`PACKAGE_PARAMS_INVALID` 内联展示
- [x] 2.2 App 详情展示 tasks/inputs/dataSources 清单；任务页 task-output 内联 markdown 渲染（think 折叠兜底）
- [x] 2.3 `example-apps.ts` 内嵌副本同步 + locale 双语文案 + 相关测试更新（packages/tasks/example-apps）

## 3. 验证

- [x] 3.1 agent-web 全量测试、`pnpm typecheck && pnpm lint`、agent-package-release smoke 通过
- [x] 3.2 本地栈端到端：导入 github-trending v2 → 默认参数一键运行 → 内联查看真实数据 digest；lifecycle-probe 空参数确定性输出（2026-08-29 补验于 driver：register-package + POST runs 空参数 → succeeded，task-output 为 25 仓库 schema 合规 digest（首仓 affaan-m/ECC 与实时 GitHub 一致）+ report.md 登记；lifecycle-probe 空参数 succeeded 且 task-output 物化（本轮模型拒绝扮演输出拒绝文本、round-6 同输入曾产出含 probe-ok 确定性报告——模型采样方差，已记录）。API 层等价执行；证据见 driver proposal 验证记录）
