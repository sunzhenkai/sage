# platform-ui-inspect-check — UI 空间细节检查报告

- 对象：`platform/apps/agent-web` 五个视图（chat / tasks / packages / schedules / providers）
- 模式：`mode: inspect`（只查不改，优雅重构未点名不进入）
- 环境：dev 服务 `http://127.0.0.1:9612`（`/v1` 代理到 agent-api:9610，实测 200）；Playwright MCP 截图
- 视口：桌面 1440×900；窄屏 375×812
- 间距基准：项目无显式间距刻度，按 `styles.css` 既有节奏（4px 基数、卡片 padding 20px、行间 gap 6–12px）与本页占优节奏判断
- 证据目录：`openspec/changes/platform-ui-inspect-check/evidence/`

---

## chat（对话列表 + 会话详情）

```text
scope: chat 视图 / 列表态、空态（未选会话）、会话详情态
viewport: 1440（desktop）+ 375（mobile）
evidence: screenshot — chat-desktop.png（空态）、chat-session-desktop.png、chat-mobile.png、chat-session-mobile.png
mode: inspect
findings:
  - P1 chat 会话页主列 — 消息流与输入区左缘不齐：assistant 气泡列左缘 x=626.5，composer 卡与 quick-prompts 行左缘 x=586.5（右缘均 1378.5）；composer 向左突出 40px，「试着问问」标签（10px）贴到左右栏分割线上（pane padding 0）→ 应对齐：消息列、快捷提示行、输入区共享同一左右边界（跟消息列内缩节奏走）
actions: none
recheck: pass（未改动，仅记录）
```

看过的面（无问题）：会话列表卡片行内节奏（标题/摘要紧配对、徽标+时间+箭头一行，行距均匀）；列表搜索/状态筛选/刷新工具行；详情页头部两行元信息（会话/事件/运行态 + 运行时选择器/提升为任务/事件流）；composer 内 hint 与发送按钮；空态「选择一个对话，或点 + 新建」居中；窄屏下侧栏堆叠到顶部、筛选器纵排、消息与 composer 自适应，无横向溢出。

## tasks（任务列表 + 任务详情）

```text
scope: tasks 视图 / 列表态、详情态（含时间线空态、运行日志、产物）
viewport: 1440（desktop）+ 375（mobile）
evidence: screenshot — tasks-desktop.png、tasks-detail-desktop.png、tasks-mobile.png、tasks-detail-mobile.png
mode: inspect
findings:
  - P2 tasks 详情「运行日志」卡 — 「尝试次数」下拉宽 193px，11px 字号下「尝试 2 · 2026年8月30日 02:05」被裁切（截图可见「02:0…」）→ 应对齐：下拉放宽至内容可读完，或日期改紧凑格式（如 08-30 02:05，与列表行内时间格式一致）
  - P2 tasks 详情操作卡 — 右侧「暂停/继续/取消/重试」卡与左侧元数据卡等高，按钮只占上 2/3，底部留白一截 → 应对齐：操作卡 align-self: start 或内容垂直均分，不硬撑等高
actions: none
recheck: pass（未改动，仅记录）
```

看过的面（无问题）：列表行三行结构（mono id / 类型·环境·尝试次数 / 投影新鲜度行）行距均匀；状态徽标列、命名空间列、行尾箭头各行落在同一垂直线；状态筛选 chip 组与搜索框同行（桌面）、窄屏换行自然；详情页头部（返回链接、标题+徽标、刷新）、投影状态条、元数据 label–value 两列对齐、时间线空态「暂无时间线事件。」、产物行（task-output / receipt）；窄屏下标题折行、徽标纵排无溢出。

## packages（应用列表 + 应用详情）

```text
scope: packages 视图 / 列表态、详情态（清单/发起运行/资产/Release）
viewport: 1440（desktop）+ 375（mobile）
evidence: screenshot — packages-desktop.png、packages-detail-desktop.png、packages-mobile.png
mode: inspect
findings: none
actions: none
recheck: pass
```

看过的面（无问题）：列表行（图标/名称/slug·Release 数/版本徽标/时间/箭头）；详情页头按钮组「⟳刷新 / 上传新版本 / 删除应用」同高 33px、同圆角 8px、同一基线，danger 按钮用 `--sealred-soft` 描边 + 朱砂文字，与本页按钮语言一致（computed style 已核）；「清单」label–value 两列对齐；「发起运行」表单 label–控件紧配对、输入与主按钮同排；资产行（文件名/类型/大小/sha256）间距一致；Release 行。窄屏下卡片纵排、无溢出。

## schedules（定时任务）

```text
scope: schedules 视图 / error 态（service token 未配置，当前环境真实状态）
viewport: 1440（desktop）+ 375（mobile）
evidence: screenshot — schedules-desktop.png、schedules-mobile.png
mode: inspect
findings: none
actions: none
recheck: pass
```

看过的面（无问题）：error 横幅（图标 + 加粗标题 + 说明两行，两侧留白对称，不叠双线）；页头「定时任务 + ⟳刷新」；窄屏下横幅折行正常、无溢出。注：正常列表态因服务端未配 `SAGE_SERVICE_TOKEN` 无法取证，后续配置后需补查。

## providers（服务商）

```text
scope: providers 视图 / 设置主页（运行 Agent / 工作区 provider / 语言）+「添加工作区 provider」弹窗
viewport: 1440（desktop）+ 375（mobile）
evidence: screenshot — providers-desktop.png、providers-dialog-desktop.png、providers-mobile.png
mode: inspect
findings:
  - P0 providers「运行 Agent」卡 — 绿色状态 badge「包运行：工作区 provider「…」就绪」（.badge.badge-success，white-space: nowrap）水平溢出卡片右缘：1440 下 badge right=1408 > 卡 right=1378.5（约 +30px，视觉上压过卡片发丝边框）；375 下 right=469.5，溢出约 110px 且被视口裁切（body overflow-x hidden，无横向滚动可救）→ 应对齐：badge 约束在卡片内容盒内（max-width: 100% + 省略，或允许换行），右缘跟卡片 20px padding 对齐
  - P0 providers「运行 Agent」卡（375px）— 「默认模型」select 宽 420px > 卡片内容盒 324px，溢出卡片与视口，选中项文字被裁切 → 应对齐：select 走 width: 100% / min-width: 0，跟随卡片内容盒
  - P1 providers 弹窗 — 表单内两个字段同名「模型」：上一个是从 models.dev 目录级联选择（disabled select「先选择 provider，再选择模型」），下一个是自由文本 input；同名 label 并列易混淆 → 应对齐：改名区分（如「目录模型」/「自定义模型 ID」），或二者合并为一条路径
actions: none
recheck: pass（未改动，仅记录）
```

看过的面（无问题）：左侧锚点导航（激活 pill 与非激活项文字起始边对齐）；provider 行（图标/名称/副标题 + 右侧「凭据已托管」与两个行尾操作，两行落在同一垂直线）；「+ 添加工作区 provider」入口位置；语言卡 label–控件；弹窗结构（面包屑 + 标题 + 关闭、字段间距均匀 ~16px、label–控件紧配对、适配器类型/基础 URL 双列等宽、底部分割线 + 取消左/主按钮右）。

---

## 跨视图汇总

**共性问题**

- 唯一的系统性问题是 **providers「运行 Agent」卡片的内容不随容器收缩**（badge nowrap + select 固定内容宽），桌面轻微越界、窄屏直接裁切，两条 P0 同源：弹性子项缺 `min-width: 0` / 省略策略。其余视图窄屏均无横向溢出。
- 左缘节奏：chat 会话页消息列与 composer/quick-prompts 左缘差 40px（P1），是本批唯一的跨元素对齐偏差；其它页面卡片、按钮组、label–value 列对齐均一致。

**状态齐全性**

- 已取证：chat 空态（未选会话）、schedules error 态（service token 未配置，真实状态）、tasks 详情时间线空态、providers 弹窗态、各详情展开态。
- 未覆盖：schedules 正常列表态（需服务端配置 token 后补查）；packages 空列表态（当前有 1 个应用）；chat 发送中/error 态（需实操发消息，未动数据）。

**窄屏（375px）表现**

- 整体策略为侧栏堆叠到页面顶部（约占首屏一半高度）+ 主内容纵排，chat/tasks/packages/schedules 均正常；筛选 chip 组、工具按钮换行自然。
- 仅 providers 两条 P0 在窄屏恶化成内容裁切；tasks 详情的 mono id 折行、徽标纵排均可读。

**发现清单（P0 → P2）**

| 级别 | 视图 | 位置 | 摘要 |
|------|------|------|------|
| P0 | providers | 运行 Agent 卡 · 状态 badge | nowrap 溢出卡片右缘（桌面 +30px / 窄屏 +110px 且被裁切） |
| P0 | providers | 运行 Agent 卡 · 默认模型 select | 375px 下 420px 宽溢出卡片与视口，文字被裁切 |
| P1 | chat | 会话页主列 | 消息列与 composer/quick-prompts 左缘差 40px，「试着问问」贴分栏线 |
| P1 | providers | 添加工作区 provider 弹窗 | 两个同名「模型」字段（目录选择 vs 自由输入）易混淆 |
| P2 | tasks | 详情 · 尝试次数下拉 | 193px 宽裁切「尝试 2 · 2026年8月30日 02:05」 |
| P2 | tasks | 详情 · 操作卡 | 与元数据卡硬等高，底部留白一截 |

修复归 `platform-ui-inspect-refine`，本 change 不改任何产品代码。
