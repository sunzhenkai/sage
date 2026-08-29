# ai-app-self-contained-runs-examples-ui

## Why

自闭环模型的用户可见面：现有三个示例应用定义上依赖任务级用户输入（lifecycle-probe 提示词“复述用户输入”、github-trending“等待用户提供数据”），应用页发起表单也鼓励自由文本 + 空输入警告——与新契约（App 声明参数/数据源，发起即闭环）直接冲突。

## What Changes

- 示例 v2 重造（`platform/examples/ai-apps/` + `agent-web` 内嵌副本同步）：
  - `github-trending`：声明 `dataSources`（GitHub Search API，近 N 天新建 star 降序）与 `inputs`（window: enum 1/7/30 默认 7、language 可选）、`tasks.trending-digest` 绑定 `output.schema.json` 与 files；提示词改为分析注入快照并明示数据口径。
  - `ops-analyst`：声明 `inputs`（如 incident_description 可选文本、severity enum），提示词消费参数段；数据依赖暂无（保持 references）。
  - `lifecycle-probe`：改为确定性自输入探针（不依赖用户输入；提示词固定输出可精确断言的内容），对齐生命周期 e2e 语义。
- 前端（`agent-web`）：
  - 发起运行表单按 `/v1/apps/:id` 返回的 inputs 声明渲染参数控件（文本/枚举 + 默认值），移除自由文本框与空输入警告/二次确认。
  - App 详情展示 tasks 清单（入口、参数、输出契约、数据依赖）；任务产物内联渲染（markdown 正文 + think 折叠块，消费 C 的剥离后正文）。
  - 一键导入示例面板与内嵌副本同步 v2 定义（既有逐字节一致性守卫自动覆盖）。
- 依赖 B（params/dataSources 运行时）与 C（剥离后正文）先行。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities
- `package-management-interface`: 「从包发起运行并追踪」需求更新为声明参数表单与产物内联查看。
- `ai-app-lifecycle-e2e`: 「测试 AI App 源包随库提供」需求更新为自闭环确定性探针（v2 契约、不依赖用户输入）。

## Impact

- `platform/examples/ai-apps/*`：三个源包 v2 + README 快照机制/参数说明。
- `apps/agent-web/src`：`packages.tsx`（表单/详情/导入）、`example-apps.ts`（副本）、`tasks.tsx`（产物内联）、`locale.tsx` 双语文案、测试更新。
- 文档：`examples/ai-apps/README.md`。
