# ai-app-self-contained-runs-examples-ui — Design

## Context

示例与 UI 收尾子变更；契约依据 driver `design/app-task-run-model.md` §3（manifest v2、发起入口）与 `design/phasing-and-migration.md` §4（前端迁移）。本变更是机械落地，无新架构决策，实现遵循既有 agent-web 组件与文案约定（fields.tsx / feedback.tsx / locale.tsx 双语）。

## Goals / Non-Goals

**Goals:** 三示例 v2 化、参数表单、产物内联渲染、导入面板同步。**Non-Goals:** 调度管理 UI（P8）、参数高级控件（array/object，v2 类型扩展后跟进）。

## Decisions

- **表单数据源**：`GET /v1/apps/:appId` 详情返回归一化 manifest（A 已透传 tasks/inputs/dataSources），前端据 inputs 渲染控件；多任务渲染 task 选择器（单任务隐藏）。
- **产物内联渲染**：task 详情页对 succeeded 任务按 artifact 端点拉取 content，markdown 渲染复用 `markdown.tsx`；think 折叠块复用 chat 的 `splitAssistantText` 分段展示语义（C 在服务端已剥离，前端折叠仅为兜底）。
- **lifecycle-probe 改造**：提示词改为「输出固定自检报告（含包 id、版本、段落清单）」——确定性、可硬编码断言、无外部依赖；`user input` 复述语义移除。
- **内嵌副本**：`example-apps.ts` 与磁盘示例的逐字节一致性守卫（`example-apps.test.ts`）继续生效，新增 v2 字段自动纳入守卫。

## Risks / Trade-offs

- [410 期间前端旧版仍在跑] → B 与 F 同批提交（同一 PR 序列），API 410 与新表单同时上线，无中间态用户。
