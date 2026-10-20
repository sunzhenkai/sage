## Context

应用页只有列表/详情/删除；agent-api 已有建应用和上传发布接口。浏览器 bundle 不依赖 `@sage/*`，示例内容由 Vite 静态资源分发。

## Goals / Non-Goals

**Goals:** 三个示例可导入、重复不覆盖、失败可重试、构建产物自带示例。

**Non-Goals:** 任意文件上传、示例编辑、服务端新接口、mock 写操作。

## Decisions

- **静态暴露而非内联内容**：dev/preview 用 Vite 插件从 `platform/examples/ai-apps` 读取；build 前复制到 `public/examples/ai-apps`，Vite 自动复制到 dist。替代方案内联 TS 会导致内容漂移。
- **清单手写 + 动态读文件**：清单只含 appId、标题、简介和文件列表；文件内容从静态路径读取，避免 YAML 解析依赖。新增示例需同步清单。
- **导入编排纯函数**：`importExampleApp` 接受 API 适配器与已存在 id 集合，返回 `imported | exists`，便于单测；浏览器侧 `examplesApi` 实现真实调用。
- **重复语义**：列表预检 + `APP_ALREADY_EXISTS` 归类为 exists；应用存在但发布失败时保持应用，允许重试上传。
- **UI**：沿用 `Empty`、`PageHeader`、`Dialog`、`Button`；示例选择用可聚焦按钮 + `aria-pressed`，避免新增依赖。

## Risks / Trade-offs

- [清单漂移] → README 与清单注释说明新增示例需同步；单测断言三个 id。
- [构建上下文缺 examples] → prepare 脚本显式报错，不静默产出空目录。
- [半成品应用] → 失败文案说明可重试发布；提供详情/删除路径，不自动删除。

## Migration Plan

无数据迁移。回滚删除静态资源准备步骤、`public/examples` 生成目录与 UI/API 方法；既有应用不受影响。

## Open Questions

无（示例清单手写已确认，不改变判据）。
