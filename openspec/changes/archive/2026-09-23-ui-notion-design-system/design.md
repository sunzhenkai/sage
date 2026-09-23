## Context

`target-token-map.md` 已冻结类 Notion 目标 token、状态语义和 current/target/delta。当前 `global.css` 的 `:root` 仍定义暖纸/墨绿/鼠尾草园丁台 token，共享组件和通知、badge、spinner、modal、focus ring 也使用这些 token；布局变量、三段式和 `.pane-item` 等结构契约需要保留。本 change 只负责全局 token 与共享组件皮肤，不处理六个视图 CSS。

## Goals / Non-Goals

**Goals:**

- 让 `global.css` 的最终视觉 token 与 `target-token-map.md` 冻结值一致。
- 统一共享组件的颜色、边框、状态色、圆角、字体、阴影、图标线宽和动效 token。
- 保留三段式布局变量、`.pane-item` 三态、`.is-current` 列表选中、`.is-active` 交互语义、status/alert 通知和 `prefers-reduced-motion`。
- 建立可重复运行的窄 token/样式静态检查，指出文件、token 或选择器。

**Non-Goals:**

- 不改 `ui-v1.md` 功能契约、API、状态机、错误码、安全边界或领域语义。
- 不修改 Chat/Tasks/Packages/Providers/Schedules/Settings 六份视图 CSS。
- 不引入第三方 UI 框架、暗色主题或新业务组件。
- 不因目标设计样本新建命令面板、看板、keycap 等功能。

## Decisions

1. 以 `target-token-map.md` 为精确 token 唯一来源，先替换 `:root` 再替换共享组件；不在组件里补第二套 token。
2. 保留现有语义类名和 DOM 结构，迁移只改皮肤 token 与必要的局部 CSS 选择器，降低功能回归。
3. `.pane-item.is-current` 是列表选中，`.rail-link.is-active`、`.segmented-item.is-active` 和 combobox `.is-active` 是交互语义，继续分开维护。
4. 状态色采用 target 的 info/success/warning/danger/neutral 映射，badge 与 notice 不再使用 sage/clay/steel 作为最终身份。
5. 平面结构零阴影，悬浮层统一 `--target-shadow-pop`；notice 可保留悬浮层语义但不再使用暖色阴影。
6. 动效只保留目标允许的 150–200ms opacity / 微位移和必要的状态反馈；移除园丁台 `bud-pulse` 品牌记忆点，保留 spinner 的 reduced-motion 行为。
7. 静态检查只检查可验证约束：目标 token 唯一定义、旧 token/色值残留、目标外阴影、动画 token、`prefers-reduced-motion` 和关键选中/ARIA 语义。

## Risks / Trade-offs

- [全局 token 替换会连带改变对比度、焦点环和状态识别] → 保留状态类名和布局，分阶段替换 token，并以 normal/hover/selected/loading/empty/error 样本检查。
- [局部 CSS 仍可能绕过 target token] → 在 system check 中扫描共享 CSS 和 `global.css`，未映射 token/硬编码视觉值报错。
- [移除 bud-pulse 会损失运行中状态提示] → 只移除品牌化持续呼吸，保留 spinner/status 文本和允许的状态反馈。
- [静态检查与目标文档漂移] → 检查脚本以 `target-token-map.md` 的冻结表为输入，不复制另一套 token 清单。
- [通知、modal、dropdown 影子规则容易混入平面组件] → 只允许 `--target-shadow-pop` 用于明确的悬浮层选择器，其他结构阴影失败。

## Migration Plan

1. 更新 `global.css` 头注为类 Notion 目标视觉，并按 target token 重建 `:root`。
2. 替换共享组件的 token 引用：导航、列表、按钮、输入、badge、notice、spinner、modal、empty/error、focus。
3. 保留布局变量和响应式 `--pane-list-w`，清理旧园丁台 token、硬编码色值和目标外阴影。
4. 增加 `check-ui-target-tokens.mjs`（或等价窄检查）并接入现有脚本约定。
5. 运行静态检查、`typecheck` 和 `build`，记录未覆盖的共享组件状态。
6. 若出现功能/可访问性回归，只回滚 system skin 层，不回滚目标契约或功能语义。

## Open Questions

- 无。目标 token、语义色、圆角、阴影和动效值已在 `target-token-map.md` 冻结。
