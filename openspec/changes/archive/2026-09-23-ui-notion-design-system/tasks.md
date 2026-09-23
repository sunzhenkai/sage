## 1. 全局 token 迁移

- [x] 1.1 根据 `target-token-map.md` 重建 `global.css` 的 `:root`：目标中性灰、语义色、字号、圆角、阴影、字体和动效 token 全部落地，清除园丁台主题 token。
- [x] 1.2 更新 `global.css` 主题注释与布局变量说明，保留三段式变量、`--pane-list-w` 响应式定义和仅亮色约束。
- [x] 1.3 替换全局共享选择器的旧 token 引用：导航、列表、按钮、输入、badge、notice、spinner、modal、empty/error、focus ring。

## 2. 共享组件与检查

- [x] 2.1 检查并迁移 `.pane-item`、`.rail-link`、`.segmented-item`、badge、notice、spinner、modal 等共享皮肤，保留 `.is-current` 列表选中和 `.is-active` 交互语义。
- [x] 2.2 清理园丁台色值、`bud-pulse` 品牌记忆点和目标外阴影；保留目标允许的状态反馈与 `prefers-reduced-motion`。
- [x] 2.3 增加 `check-ui-target-tokens.mjs` 或等价窄检查，检查目标 token 唯一定义、旧 token/色值残留、平面阴影、动画 token、reduced-motion 和关键选中/ARIA 语义，并接入 package scripts。
- [x] 2.4 运行窄静态检查、`corepack pnpm --filter @sage/agent-web typecheck`、`corepack pnpm --filter @sage/agent-web build`，记录结果和未覆盖状态。
- [x] 2.5 运行 `openspec validate --strict --type change ui-notion-design-system`，将结果写入 proposal 验证记录。
