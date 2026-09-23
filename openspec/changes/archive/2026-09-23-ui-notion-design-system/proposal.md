## Why

`docs/design/ui/target-token-map.md` 已冻结类 Notion 目标视觉，但 `platform/apps/agent-web/src/styles/global.css` 及共享组件仍以暖纸、墨绿、鼠尾草的园丁台视觉运行。若不先收敛全局 token、状态色、字体、圆角、阴影和共享组件皮肤，后续视图迁移会继续放大视觉漂移。

## What Changes

- 将 `global.css` 的主题注释、`:root` token、颜色、边框、状态色、圆角、字体、阴影和动效迁移到 `target-token-map.md` 的冻结值。
- 同步共享组件皮肤：`.pane-item`、`.rail-link`、按钮、输入框、badge、notice、spinner、modal、empty/error、focus ring 和响应式壳层。
- 保留布局变量、三段式结构、`.pane-item` 三态、`.is-current` 列表选中、`.is-active` 交互语义、通知 status/alert 与 `prefers-reduced-motion`。
- 增加窄 token/样式静态检查，拦截园丁台 token/色值残留、目标 token 不一致、平面阴影和未映射动画。

## Non-goals

- 不修改六个视图 CSS、业务逻辑、API、状态机或领域语义。
- 不新增第三方 UI 框架、暗色主题或产品功能。
- 不把目标设计样本扩成命令面板、看板、keycap 等新组件。

## 涉及面

| 仓库 | 角色 | 说明 |
|------|------|------|
| . | 必须 | 修改 `platform/apps/agent-web/src/styles/global.css`、共享组件相关样式和窄静态检查 |

## 验收标准

- [x] `global.css` 的最终视觉 token 与 `target-token-map.md` 冻结值一致，园丁台视觉不再作为运行时身份。
- [x] 共享组件的静息、hover、selected、loading、empty、error、danger、focus 状态按目标语义色和 token 呈现。
- [x] 保留 `ui-v1.md` 功能语义、三段式结构、`.pane-item`/`.is-current`/`.is-active` 语义、通知行为和 reduced-motion。
- [x] 静态检查可重复运行并明确列出违规文件、token 或选择器。
- [x] `openspec validate --strict --type change ui-notion-design-system` 通过。

## 验证记录

- [x] `check:ui-tokens`：`UI target token check: OK (35 target tokens, 1 CSS files)`；范围为 `global.css` 共享系统层，视图 CSS 由 `ui-notion-design-views` 迁移后复用同一检查。
- [x] `corepack pnpm --filter @sage/agent-web typecheck` 通过。
- [x] `corepack pnpm --filter @sage/agent-web build` 通过（43 modules transformed，CSS 33.11 kB，JS 350.28 kB）。
- [x] `openspec validate --strict --type change ui-notion-design-system`：`Change 'ui-notion-design-system' is valid`。
- [x] `global.css` 不含园丁台 token/色值和 `bud-pulse`，保留 `.pane-item.is-current`、`.is-active` 语义、`prefers-reduced-motion`、目标状态色和共享组件皮肤。
