# QA 修复后验收截图（qa-fixed）

对照 `archive/2026-08-30-agent-web-multica-style-alignment/qa/` 的 24 项问题逐项复检。截图环境：agent-api(9610) + agent-web vite dev(9612)，视口 1440×900；除标注 en 外均为 zh-CN。验收同时做了 DOM 级断言（bounding box / computed style / className），截图用于视觉留档。

| 文件 | 覆盖问题 | 验收结论 |
| --- | --- | --- |
| qa-fixed-01-list-pane-zh.png | A1 归档按钮垂直居中、A5 搜索框独占一行不贴右缘、A6 紧凑时间（MM-DD HH:mm） | ✅ 视觉检查通过（vision 复核：按钮居中、徽章/日期间隔 9px+、搜索框独立行） |
| qa-fixed-02-chat-header-selected-zh.png | A2 选中高亮（is-active + aria-current）、B1 头部孤行消除（chat-heading-info/tools 分组）、B2 标题为会话标题「你好」 | ✅ DOM：`aria-current="page"`、h1=会话标题、tools 组 3 控件同行 |
| qa-fixed-03-event-stream-dedup-zh.png | B4 事件流面板去重 | ✅ 面板头部仅「复制事件流」，无 session/events/run 信息条 |
| qa-fixed-04-list-pane-en.png | A4 英文徽章/日期重叠修复 | ✅ DOM：6 行徽章与日期 bounding box 无相交 |
| qa-fixed-05-task-detail-zh.png | C1 详情态单刷新、C3 时间线空态去「投影」 | ✅ DOM：全页仅详情页头 1 个 ↻ 刷新；空态文案「暂无时间线事件。」 |
| qa-fixed-06-providers-nav-zh.png | E3 设置子导航 active 态 | ✅ DOM：`aria-current="location"` + is-active 背景 rgb(229,230,226) |
| qa-fixed-07-provider-modal-zh.png | D2/E1 弹窗迁移 Modal 原语、取消在左保存在右、E2 字段栅格两行对齐 | ✅ 视觉检查通过（vision 复核）；DOM：面包屑「服务商 › 添加工作区 provider」、取消 x=384 左 / 保存 x=912 右、适配器+基础 URL 同行 329px 等宽 |
| qa-fixed-08-schedules-error-zh.png | F1 定时任务错误态 Banner 化 | ✅ DOM：`.error-banner[role=alert]`，保留 SAGE_SERVICE_TOKEN 配置指引 |
| qa-fixed-09-collapsed-zh.png | G1 折叠态头部堆叠 | ✅ 视觉检查通过（vision 复核）；DOM：head flex-direction=column、印章 y=14 / 切换 y=50 无重叠 |
| qa-fixed-10-packages-list-zh.png | D3 版本号去双写、D8 紧凑时间 | ✅ DOM：每行版本号仅徽章一处，时间为 08-30 14:09 紧凑格式 |
| qa-fixed-11-app-detail-empty-manifest-zh.png | D1 manifest 空值行隐藏、发起运行卡无悬空分隔线 | ✅ DOM：空 skills/capabilities/inputs/dataSources 行均不渲染、无「—」、运行卡无 form-actions |

补充说明：
- C2 attempt 选择器放宽：现有任务均单 attempt（选择器按设计不渲染），经 live CSSOM 验证规则为 `max-width: min(320px, 100%)`。
- G2 搜索视觉位中性化：DOM 文本为「搜索 + ⌘K」。
- G3 壳层主操作错误出口：组件级测试覆盖（sidebar-collapse.test.tsx 断言失败经 `sidebar-action-error` 行内 alert 呈现且按钮恢复可用）。
- provider 弹窗 vision 复核提到背景层 provider 卡片的 ◆ 字形疑似 tofu：DOM 字符正常，属本机字体渲染差异，不在本 change 24 项问题范围内。
