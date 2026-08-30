# Proposal: agent-web-qa-polish

## Why

`agent-web-multica-style-alignment` 完成三栏壳层与话语层治理后，对全部页面/组件/双语做了系统性浏览器 QA（17 张现场截图归档于该 change 的 `qa/` 目录），发现 24 个问题。其中 7 个是用户可直接感知的破损或不一致（如归档按钮错位、详情页双刷新、定时任务错误态裸文本、provider 弹窗按钮顺序与 Modal 形态不一致），需单独 change 收敛修复，并补齐测试契约防止回潮。

## What Changes

- **会话列表栏修复**：归档/行操作按钮对齐至 meta 行；新增当前会话选中高亮（aria-current）；英文长日期与徽章重叠修复；搜索框宽度修正；日期按栏宽缩短为紧凑格式（MM-DD HH:mm）。
- **会话页头部修复**：动作区补 `min-width: 0` 与分组，消除孤行；大标题改为当前会话标题；事件流面板删除与头部重复的会话信息条。
- **任务详情修复**：详情态隐藏列表页头的刷新按钮（消除双刷新）；attempt 选择器放宽宽度；`noProjectionEvents` 去「投影」机制术语。
- **应用页修复**：发起运行卡空表单不再渲染悬空分隔线；清单卡隐藏「—」空值行；列表行版本号去除双写。
- **服务商页修复**：provider 弹窗按钮顺序统一为「取消在左、主按钮在右」并增加面包屑标题；Esc 行为统一（聚焦弹窗才生效可接受，但 backdrop 点击穿透修复）；字段栅格收敛；设置子导航增加 active 态。
- **定时任务页修复**：错误态由 `banner banner-error`（无样式）修正为全局 `Banner` 组件。
- **壳层修复**：折叠态侧栏头部印章与切换按钮垂直堆叠消除挤压；搜索视觉位文案中性化；壳层主操作失败有错误出口（复用 toast 通道）。
- **Modal 统一**：provider 弹窗迁移到 `Modal` 原语（面包屑 + 统一 Esc/焦点圈定），消除两套模态实现的行为漂移。
- **文案/时间格式**：列表时间戳按 locale 输出紧凑格式；`chatPrompt` 类残余术语清查。
- 以上每项伴随测试断言更新或新增（`data-testid`/aria 保持不变）。

## Capabilities

### New Capabilities

（无。）

### Modified Capabilities

- `workspace-shell`: 折叠态头部堆叠约定、侧栏主操作错误出口、搜索视觉位文案口径。
- `chat-user-interface`: 会话列表选中态、头部动作区分组、事件流面板去重、会话标题呈现。
- `task-operations-interface`: 详情态刷新按钮唯一性、attempt 选择器可读性、时间线空态去术语。
- `package-management-interface`: 详情卡空值隐藏、运行卡空表单形态。
- `web-interface-design-language`: 既有质量底线补充——双语长文案在固定窄栏内的截断/换行规则、按钮主序约定（主操作居右）。

## Impact

- **代码**：`workspace.tsx`、`chat.tsx`、`tasks.tsx`、`packages.tsx`、`providers.tsx`、`workspace-providers.tsx`、`schedules.tsx`、`main.tsx`、`locale.tsx`、`styles.css`、`fields.tsx`（Modal 增强）。
- **测试**：`workspace.test.tsx`、`chat*.test.tsx`、`tasks*.test.tsx`、`packages.test.tsx`、`providers.test.tsx`、`workspace-providers.confirm.test.tsx`、`sidebar-collapse.test.tsx`、`responsive-a11y.test.tsx`、`header-alignment.test.tsx`。
- **Spec**：上述 5 个 capability 的 delta；归档时回写主 spec。
- **不影响**：HTTP API、运行时、数据契约、路由参数。
