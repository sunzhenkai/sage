# 类 Notion 目标视觉 token 与迁移清单

- 状态：target-contract
- 目标权威：[`design-language.md`](./design-language.md)
- 运行时事实：[`platform/apps/agent-web/src/styles/global.css`](../../platform/apps/agent-web/src/styles/global.css)
- 适用：`platform/apps/agent-web` 的视觉迁移与视觉验收；不改变 `ui-v1.md` 功能契约。
- 版本：v1（冻结于 2026-09-23）

## 权威边界

1. `ui-v1.md` 是功能行为唯一权威。
2. `design-language.md` 是目标视觉唯一权威。
3. `layout-v1.md` 是结构、交互和功能可观察行为的契约。
4. 本表是目标 token 与当前运行时 token 的唯一迁移映射；精确值以本表冻结值为准，`global.css` 只能按本表落地。
5. 任何冲突记录为 delta，不在实现中自行取近似值或改变目标身份。

## Target token

| Token | 目标值 | 用途 | 当前对应 | Delta |
|---|---|---|---|---|
| `--target-paper` | `#FFFFFF` | 主内容画布 | `--paper #F7F5EF` | 从暖纸改为纯白 |
| `--target-surface` | `#F9FAFB` | 侧栏 / 面板 | `--surface #FFFEFB`、`--surface-sunken #EFEDE4` | 统一为 gray-50 面板 |
| `--target-surface-hover` | `#F3F4F6` | hover / 选中洗色 | `--sage-mist #F2F6EF` | 从鼠尾草淡色改为 gray-100 |
| `--target-ink` | `#111827` | 主文字 | `--ink #1E251E` | 改为 gray-900 |
| `--target-muted` | `#6B7280` | 次级文字 | `--muted #5D665A` | 改为 gray-500 |
| `--target-faint` | `#9CA3AF` | 占位 / 元信息 | `--faint #8B927F` | 改为 gray-400 |
| `--target-line` | `#E5E7EB` | 发丝线 / 默认边框 | `--line #E3E0D2`、`--line-strong #CBC7B4` | 从暖灰绿改为空灰 |
| `--target-line-strong` | `#D1D5DB` | 控件边框 / hover | `--line-strong #CBC7B4` | 与发丝线分层 |
| `--target-success` | `#16A34A` | 审核中 / 成功 | `--sage #3E6B4A` | 鼠尾草改为目标绿 |
| `--target-success-wash` | `#F0FDF4` | 成功淡色表面 | `--sage-wash #E7EFE4` | 改为 50 号淡绿 |
| `--target-warning` | `#D97706` | 进行中 / 警告 | `--amber #7A5D16` | 改为琥珀语义色 |
| `--target-warning-wash` | `#FFFBEB` | 警告淡色表面 | `--amber-wash #F4EDD8` | 改为 50 号淡琥珀 |
| `--target-info` | `#2563EB` | 完成 / 链接 / 焦点环 | `--steel #3D5A73` | 钢蓝改为目标蓝 |
| `--target-info-wash` | `#EFF6FF` | 信息淡色表面 | `--steel-wash #E4EBF1` | 改为 50 号淡蓝 |
| `--target-danger` | `#DC2626` | 阻塞 / 失败 / 危险 | `--clay #A3492B` | 陶土红改为目标红 |
| `--target-danger-wash` | `#FEF2F2` | 危险淡色表面 | `--clay-wash #F5E7DF` | 改为 50 号淡红 |
| `--target-neutral-wash` | `#F3F4F6` | 待办 / 取消 / 元信息 | `--surface-sunken #EFEDE4` | 统一 neutral surface |
| `--target-radius-sm` | `4px` | keycap、chip、小徽章 | `--radius-sm 5px` | 调整到目标阶梯 |
| `--target-radius-md` | `8px` | 输入框、按钮、菜单项、列表项 | `--radius 8px` | 保留目标值 |
| `--target-radius-lg` | `12px` | 设置表单卡、任务卡、模板卡 | 无独立 token | 新增 |
| `--target-radius-xl` | `16px` | 悬浮层、下拉、聊天输入 | 无独立 token | 新增 |
| `--target-shadow-flat` | `none` | 面板、卡片、行 | 多处布局无阴影 | 保持零阴影 |
| `--target-shadow-pop` | `0 16px 40px rgba(17,24,39,.14)` | 命令面板、下拉、模态 | `--shadow-pop 0 10px 32px rgba(30,37,30,.16)` | 调整悬浮层阴影 |
| `--target-font-sans` | `Inter, "PingFang SC", system-ui, sans-serif` | 界面字体 | `--sans` 系统栈 | 明确 Inter + PingFang |
| `--target-font-mono` | `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` | inline code / key / ID | `--mono` | 保留语义，统一命名 |
| `--target-font-xs` | `12px` | 元信息、计数、keycap | 现有 12px | 保留 |
| `--target-font-sm` | `13px` | 说明文字 | 现有 13px | 保留 |
| `--target-font-md` | `14px` | 正文、导航 | 现有 14px | 保留 |
| `--target-font-lg` | `16px` | 区块标题 | 现有 15/17/18/19px 混用 | 收敛到目标阶梯，必要处由语义样式扩展 |
| `--target-font-weight` | `400 500 600` | 正文 / 强调 / 页面标题 | 现有多档字重 | 收敛目标字重 |
| `--target-line-height` | `1.6` | 说明文字 | 现有 body 1.55 | 说明文字目标采用 1.6 |
| `--target-icon-stroke` | `1.5px` | 线性图标 | 现有 1.7-2px | 收敛目标线宽 |
| `--target-motion-fast` | `160ms` | hover / 浮层 opacity | `--dur-fast 140ms` | 目标采用 160ms |
| `--target-motion-slow` | `180ms` | 浮层 scale + fade | 现有 1.6s bud-pulse | 仅轻量浮层使用 180ms |
| `--target-motion-status` | `160ms` | 状态反馈 | 现有 120ms / 1.6s 混合 | 统一状态反馈时长 |

目标语义映射：

- 待规划 / 待办：`neutral` + 空心圆。
- 进行中 / 警告：`warning` + 动态图标。
- 审核中 / 成功：`success` + 圆圈对勾。
- 已完成 / 链接 / 焦点环：`info` + 实心圆对勾 / 链接色。
- 已阻塞 / 失败 / 危险：`danger` + 禁止符 / 危险操作色。
- 彩色只服务状态、危险操作、选中反馈和链接；其他元信息使用 neutral / muted。

## Current / target / delta 迁移清单

本节是 current/target/delta 的唯一迁移记录；实现阶段逐项关闭，不得以近似值替代冻结值。

| Surface | Current | Target | Delta | 验收 |
|---|---|---|---|---|
| 主题身份 | 园丁台：暖纸、墨绿、鼠尾草 | 类 Notion：白底、中性灰、低饱和语义色 | 全量替换主题 token 和主题注释 | 主界面不含园丁台色相 |
| 颜色 token | `--paper/--surface/--ink/--sage/--clay/--amber/--steel` | 本表 `--target-*` | `global.css:root` 统一替换 | token 静态检查 |
| 状态徽标 | sage/clay/amber/steel | info/success/warning/danger/neutral | badge 状态映射重写 | normal/selected/error 截图 |
| 列表选中 | `.pane-item.is-current` sage-wash + inset | gray-100/200 洗色 + info 焦点或选中 | 保留 `.is-current`，只改 token | `.pane-item` 三态检查 |
| 导航 active | `.rail-link.is-active` sage-wash | gray-100 灰胶囊 | 保留 `.is-active` 语义 | 导航截图 |
| 平面层级 | 卡片/面板零阴影 | 仍是零阴影 + 1px 发丝线 | 删除不必要阴影 | CSS 阴影检查 |
| 悬浮层 | `--shadow-pop` 暖色暗影 | `--target-shadow-pop` 柔和中性暗影 | modal / dropdown / notice 改 token | modal/notice 截图 |
| 字体 | 系统栈 + 多档字号 | Inter/PingFang + 12/13/14/16px 目标阶梯 | 收敛字号、字重、行高 | type scale 检查 |
| 圆角 | `--radius-sm=5px`、`--radius=8px` | 4/8/12/16px 阶梯 | 新增 radius-lg/xl | 样式检查 + 截图 |
| 图标 | 线宽 1.7-2px | 1.5px 线性单色 | 统一 SVG stroke | 图标截图 |
| 动效 | view-in、notice-in、bud-pulse、spin | 150-200ms opacity / 微位移 | 移除园丁台 bud-pulse 记忆点，保留状态反馈 | reduced-motion 检查 |
| 空态 | 图标 + 灰字 | 同目标：线性图标 + 灰字，富空态用白卡 | 仅改视觉 token | empty 截图 |
| 未采用组件 | 命令面板、看板列、keycap、模板卡样本 | 不新增功能 | 仅作视觉样本，不进入实现范围 | 文档边界检查 |

## 迁移检查

- 目标 token 必须在 `global.css:root` 有唯一定义；实现值不得偏离本表冻结值。
- 园丁台 token、暖纸/墨绿/鼠尾草色值和 `bud-pulse` 品牌记忆点不得残留为最终视觉身份。
- 平面结构不得增加非目标阴影；悬浮层只使用 `--target-shadow-pop`。
- 动效必须支持 `prefers-reduced-motion`。
- 视觉迁移不得改变 `ui-v1.md` 的 API、状态机、错误码、安全边界和可访问性语义。
