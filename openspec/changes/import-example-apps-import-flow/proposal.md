## Why

应用页为空时没有可操作的入口，用户只能靠命令行登记示例包。本子 change 打通「选择仓库内置示例 → 建应用 → 上传发布 → 列表/详情可见」的最小闭环，并复用 agent-api 既有接口。

## What Changes

- agent-web 构建期/开发期暴露 `platform/examples/ai-apps` 源文件（不引 `@sage/*`）
- 新增示例清单、源文件加载与导入编排模块 + 单测
- `api.apps` 增加 `create` 与 `uploadRelease`
- 应用页空状态与页头增加「导入示例应用」，对话框展示进度、成功、已存在与失败
- 中英文文案与 README 更新

## Capabilities

### New Capabilities
- `agent-web-example-app-import`: 从仓库内置示例导入应用并处理重复与失败的行为。

### Modified Capabilities
（无）

## Impact

- `platform/apps/agent-web/src/pages/apps.tsx`、`src/lib/{api,example-apps}.ts`、`src/lib/locales/{en,zh-CN}.ts`、`README.md`
- `platform/apps/agent-web/{package.json,vite.config.ts,scripts/prepare-examples.mjs}`
- 不改 agent-api 路由与错误语义
