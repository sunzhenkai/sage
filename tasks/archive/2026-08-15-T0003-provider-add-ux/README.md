# 优化 Provider 添加体验

**id：** T0003
**status：** archived
**slug：** provider-add-ux
**创建时间：** 2026-08-15

---

## 概述

优化 Agent Web 的 Provider 添加体验：通过弹窗引导选择 Provider 和模型，自动填充可编辑的名称与 Base URL，安全输入当前 tab 的 API key，并在已保存 profile 上提供连接检测入口。

## 背景

当前 Provider profile 已支持浏览器本地 metadata、Provider Catalog 搜索、模型选择和 tab-only secret，但添加入口直接展开编辑面板；连接检测没有明确的用户操作与状态反馈。目标是保留现有 runtime boundary 和 secret isolation，同时把添加流程做成清晰、可验证的体验。

## 目标

1. 点击 Add provider 后打开具备 dialog 语义的添加 Provider 弹窗。
2. 先选择 Provider；选中后自动加载并填充 Provider 名称、模型候选和 Catalog 提供的 Base URL。
3. 模型可选择，Base URL 和显示名称可编辑，名称默认使用 Provider 名称。
4. API key 只作为当前 tab secret 输入，不写入 profile metadata。
5. 保存 profile 后在 Provider 列表提供连接检测图标和成功/失败状态反馈，失败不泄露 API key。

## 现状缺口

| # | 缺口 | 类型 | 说明 | 建议补齐 |
|---|------|------|------|----------|
| 1 | 添加入口不是 modal/dialog | 实现 | 当前为右侧编辑面板，缺少聚焦的新增流程与可访问 dialog 语义 | 在既有 ProvidersApp 内实现可复用 modal，不改 profile 存储边界 |
| 2 | 连接检测入口和协议缺失 | 实现 | 当前无 Provider profile 的连接检测接口或列表图标状态 | 增加受控检测 API 与前端状态按钮，复用现有 adapter/base URL/model metadata |
| 3 | Catalog/API 错误状态需覆盖新增交互 | 实现 | 现有 Provider/Model 查询已有 snapshot 防护，新增 modal 和检测需有回归测试 | 补充 Web/API 定向测试 |
| 4 | 现有 Provider 设计约束需保持 | 依赖确认 | API key 必须保持 tab-only，profile metadata 不承载 secret；Local Pi runtime 保持只读 | 对照已有 provider profile/catalog 设计和现有测试实现 |

## 需求说明

### 涉及面

| 逻辑库 | 路径 | 角色 |
|--------|------|------|
| sage | `.` | 必须 |

### 关联 OpenSpec

| change | 路径 | 仓库 | store | 说明 |
|--------|------|------|-------|------|
| `provider-add-ux` | `openspec/changes/provider-add-ux/` | `.` | `—` | Provider modal、字段自动填充与连接检测 |

### 设计文档

| 文档 | 类型 | 归档落点 |
|------|------|----------|
| — | | 无；当前范围局部且实现路径明确 |

## 工作上下文

事实一出现或变化就立刻改这里，不要等 archive。涉及面是计划范围；本节是实际执行环境。

| 仓库 | 仓库路径 | checkout 路径 | worktree | 分支 | 基线 |
|------|----------|---------------|----------|------|------|
| . | `.` | `.` | 否 | `feat-provider-add-ux` | `fix-workspace-usability` |

## 验收标准

- [x] Add provider 按钮打开 modal/dialog，取消不会产生 profile。
- [x] modal 首先提供 Provider 选择；选择 Provider 后自动填充 Provider 名称、模型候选和 Catalog Base URL。
- [x] 模型可选择，名称默认 Provider 名称且名称可改，Base URL 可改。
- [x] API key 为 password 输入，保存后只写入当前 tab secret，不进入 localStorage metadata。
- [x] 保存成功后 Provider profile 出现在列表中，且列表项提供连接检测图标。
- [x] 连接检测支持 loading/success/failure 状态，失败消息稳定脱敏且不包含 API key。
- [x] Provider/API/类型与现有 profile/catalog 测试通过，Web 类型检查和构建通过。

## 变更记录

| 日期 | 变更 |
|------|------|
| 2026-08-15 | 创建任务，状态 draft |
| 2026-08-15 | 确认代码仓为 `sage`，基线为 `fix-workspace-usability`，实现模式为新增 |
