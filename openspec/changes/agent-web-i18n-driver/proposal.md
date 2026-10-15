## Why

agent-web 多语言（中/英）

目标：agent-web 控制台（platform/apps/agent-web）支持中文 + 英文——按浏览器语言自动推断（默认英文），设置页可手动切换并持久化；覆盖全部界面文案与本地化格式化；配套：服务端未命名会话搜索回退默认改为英文、前端会话查询携带当前 locale。

完成判据（原文）：agent-web 全量界面文案随浏览器语言自动显示中文或英文（zh* → 中文；其余含无匹配 → 英文），设置页可手动切换并持久化；中英文两态下关键路由在 1280x800 与 375x812 渲染可用且 axe 无 serious/critical，typecheck / build（含 check:design）/ lint / test 全部通过。

已采纳方案（simple + adopt-only）：自研 typed 词典（src/lib/i18n.ts + locales/en.ts|zh-CN.ts；en 为源、zh 键位对齐单测）；Settings → Appearance 增 Language（Auto / English / 中文）；服务端 normalizeHistoryLocale 默认改 en、listSessions 携带 locale；术语与文体以 tasks/ongoing/agent-web-i18n/glossary.md 为准。

流程总览（原文）：
1. 语言核心 src/lib/i18n.ts（检测 / ?lang= 覆盖 / 插值 / 订阅 / html lang）+ 单测 — 验证：vitest 绿
2. 词典 locales/en.ts（源）+ locales/zh-CN.ts + 键位对齐测试 — 验证：对齐测试绿
3. 全量文案提取（pages / layout / bui / ui / utils）— 验证：抽查无残留硬编码 + 逐页走查
4. Settings Language 行（Auto / English / 中文）+ 即时切换与持久化 — 验证：刷新持久、document.lang 同步
5. 服务端默认 en + 前端会话查询带 locale — 验证：chat-domain 单测绿、zh 界面搜「未命名」命中
6. 工程门 typecheck / build / lint / test — 验证：全部 exit 0
7. 运行态证据（ui_evidence_check 双语两视口）+ README 更新 — 验证：report exit 0（否则按确认协议处理）

交付类别：Web UI。适用门包：gate-packs.md「Web UI」（simple 档调度 + adopt-only）。基准物：WCAG 2.2 AA（axe 地板）+ 交付仓 DESIGN.md / check:design + 本任务词典（en 为准）；禁止外部产品作验收基准。

Active Instance 根路径：不适用（adopt-only，simple 档）；contract digest：不适用；binding digest：不适用；projection digest：不适用。

adopt-only 显式降级原文（已 confirmed，2026-10-15 用户「按推荐冻结并交接」）：
1. 维度：设计系统基线 / 定级：B 类 / 默认期望：Web UI 交付应有 frozen design-system/v1 Active Instance / 实际选择：adopt-only——沿用现有组件库与样式体系（DESIGN.md + check:design），豁免 Active Instance / 原因：simple 档机制；本任务零新设计表面 / 回滚说明：后续 UI 任务补建 design-system/v1 至 freeze / 确认状态：confirmed。
2. 维度：重型证据门调度 / 定级：B 类 / 默认期望：medium/complex 硬门（ui_evidence_check + design 评审文件）/ 实际选择：ui_evidence_check 照计划执行；design 评审文件不设 / 原因：simple 档调度（SHOULD）/ 回滚说明：需要时补 design 评审文件并复验 / 确认状态：confirmed。

指针：tasks/ongoing/agent-web-i18n/（wizard/plan.md、glossary.md、design/contract.md、approve/APPROVED.md）。

## What Changes

- 本 change 是 taskflow driver，不直接改代码，只编排子 change
- 单切片（simple 档）：子 change `agent-web-i18n-implement` 承载全部实施（i18n 核心 + 词典 + 全量文案提取 + Settings 语言项 + 服务端配套 + 运行态证据 + README 更新）

## Non-goals

- 不建 `design-system/v1` Active Instance（adopt-only 降级已确认）
- 不本地化服务端错误文案 / mock 数据；不改英文既有文案；不做 URL 路由式 locale；不加第三方语言

## 涉及面

| 仓库 | 角色 | 说明 |
|------|------|------|
| . | 必须 | 同仓修改 `platform/apps/agent-web` 与 `platform/packages/chat-domain` |

## 验收标准

- [ ] agent-web 全量界面文案随浏览器语言自动显示中文或英文（zh* → 中文；其余含无匹配 → 英文），设置页可手动切换并持久化；中英文两态下关键路由在 1280x800 与 375x812 渲染可用且 axe 无 serious/critical，typecheck / build（含 check:design）/ lint / test 全部通过。
- [ ] 流程总览 7 步全部完成并有验证记录（vitest 绿 / 键位对齐测试绿 / 无残留硬编码抽查 / 刷新持久化手测 / chat-domain 单测绿 / 工程门 exit 0 / ui_evidence report exit 0）
- [ ] 显式降级 2 条在验证记录中逐项可追踪（维度 / 实际选择 / 用户确认来源 2026-10-15「按推荐冻结并交接」）

## Driver 协议

- 本 change 无 spec 增量（`.openspec.yaml` 已设 `skip_specs: true`）
- 子 change 一律命名 `{task}-<slice>`，与本 change 同一 planning root；跨 root 时在涉及面表显式记录 root 或 store id
- 实现进度只认子 change 自己的 `tasks.md`；本文件的 checkbox 只在对应子 change 全勾且 `validate --strict` 通过后才勾
- 切任务分支只针对涉及面里角色为 `必须` 的修改仓，且本身可选；task 所在仓不是修改仓时不切。修改仓干净：先 fetch 默认分支，再从其最新提交 `git switch -c`（分支已存在则 `git switch`）。修改仓 dirty：列出未提交路径，由用户三选一——不切直接在当前分支修改 / 携带改动 `git switch` / `git worktree add` 从默认分支最新提交建独立工作树。不得 stash / reset / 强制切换。用户未选择、git 拒绝或切错仓时停下
- 只有「checkbox 全勾」「需要用户决策」「本轮预算耗尽」三种情况允许结束一轮；单项做不了就保持未勾，在验证记录写一行原因后继续下一项；「需要用户决策」只停依赖该项的条目，其余条目继续
- 结束时逐条列出未勾项与原因，不按 change 汇总

## 验证记录

- 2026-10-15 propose：子 change `agent-web-i18n-implement`（proposal / specs / tasks）与 driver tasks.md 就绪；两 change `openspec validate --strict` 通过。design.md 为 schema 条件项，两 change 均跳过（driver 为纯编排；实现接口与机制见本 proposal「Why」与子 change tasks 描述）。
- 2026-10-15：openspec 于 sage 根初始化（`openspec init --tools none --language 简体中文`）；`taskflow/scripts/check_handoff.py` 入口门 exit 0。
- 2026-10-15 apply 启动：用户确认不切分支（直接在 main 实现；driver 1.1 勾选）；实施按子 change `agent-web-i18n-implement` 分批推进——W1 核心与词典骨架（1.1–1.3）→ W2+ 页面/组件提取（2.x）→ 格式化与设置（3.x）→ 服务端配套（4.x）→ 证据与文档（5.x）。
- 2026-10-15 实施批次记录（子 change `agent-web-i18n-implement`，词典累计 588 键）：
  - W1：1.1–1.3（i18n 核心 + 单测 16 例 + 词典骨架与键位对齐测试）done。
  - W2：2.1（overview/apps/packages/settings/not-found，+196 键）done；W3：2.2（chat/tasks/schedules/providers，+285 键）“status.*” 统一 done。
  - W4：2.3+2.4（layout/ui/bui/charts 内置文案；shortcuts 文案收敛为单源）done。
  - W5：3.1–3.3（时间/相对时间/图表轴本地化 + utils 单测；Settings→Appearance Language 行；index.html lang=en 与启动接线）done；真实 chromium 22/22 断言（en/zh/?lang=/切换即时/持久/Auto/未持久化）。
  - W6：2.5+4.1+4.2（残留扫描收口：补 `disabled/stale/unavailable/promoted` 状态词；标签页标题随语言；chat-domain `normalizeHistoryLocale` 默认改 `en` 并更新单测；`listSessions` 携带 locale 且 query key 含 locale）done；playwright 10/10（请求带 locale=zh-CN/en、title/lang 即时切换）+ curl 命中验证（zh-CN 命中未命名、en 不命中）。
  - 残留扫描结论（2.5）：三类 grep 命中均为允许项（品牌/键名/枚举值/URL/标识符/mock）；`deprecated/legacy`（数据原值展示）与未渲染枚举按数据保留。
- 2026-10-15 环境观察：运行中 `sage-mvp-agent-api-1` 为改动前镜像（无源码挂载），4.1 的默认值端到端生效需重建镜像（列入 5.x 运行态证据批次）。
- 2026-10-15 W7（5.1–5.4 + 运行态）：manifest 落 `platform/evidence/agent-web-i18n/ui-manifest.json`；axe 4.14.0 于 `platform/.evidence/agent-web-i18n/tools/axe.min.js`（未动依赖清单）；证据 run w7 = PASS（axe 0 / 双视口齐 / 焦点走查 15 步）；工程门四连全绿——agent-web typecheck、build（含 check:design）、`pnpm lint`、`pnpm test`（148 files / 918 tests passed）；`agent-api/agent-worker` 镜像重建（~11min，均 Healthy）后 4.1 端到端闭合（无 locale `q=Untitled Chat` 命中 3、`q=未命名` 不命中、显式 `locale=zh-CN` 命中 3）。W7 为过 axe 门修复既有缺陷：对比度 token 校准（`--ink-3`、`--green`、`--red`、`--orange`、`--accent-ink`，light+dark ≥4.5:1）、session-list 运行态文字、providers 下拉 aria-label、Heatmap tabIndex+aria-label、tasks/overview 切换控件移入工具行、`eslint.config.js` 忽略 `.evidence/**`。
- 2026-10-15 验收评审（role-based-reviewer，roles=product,design,engineer；依据状态 w7 dirty：diff `e004db…`/66 文件；design 评审记录落 `tasks/ongoing/agent-web-i18n/design/review-ui.md`，`--validate-review` exit 0）：
  - F-1（design 主责，Major）：375x812 内容裁切、设置页语言控件指针不可达（panel 实测 147px vs chat scrollWidth 424；`app-shell.tsx:55` 侧栏固定 220px + `:128` overflow-hidden）。归因=既有桌面优先实现，本任务 diff 未引入；**待用户决策**（A 类判据调整 or 修复）。
  - F-2（engineer，Major）：焦点走查 tab_steps=15 仅覆盖侧栏 → **fixed**：升 70 步复跑暴露 `.recharts-surface{outline:none}` 焦点环缺陷（58 项）并修复；w8 走查覆盖 23–56 步/路由（含内容控件）。
  - M-1（loading 口径）**fixed**；M-2（README 375 措辞）待 F-1 决策后同步；M-3（`--accent` 文本对比度 3 处）**fixed**（换 `--accent-ink`，≥4.57:1）；M-4（dark 主题缺少运行态证据）**recorded**（token 实算；后续 dark 证据批次复查）。
  - 五维初评：功能闭环 3 / UI/UX 1（响应式 0 分，F-1） / 工程质量 3 / 画像一致性 2（375 条款未达未登记） / 证据 2（F-2 已修，待复验收敛）。
- 2026-10-15 W8 修复与复跑（F-2/M-1/M-3）：证据 run w8 = PASS（axe 0 / focus_invisible 0 / 双视口齐）；受影响层复跑全绿（typecheck / check:design / eslint / lib 测试 / sub-change validate）。新 dirty 摘要：diff `18f3fb…` / 未跟踪 `35baee…` / 67 文件（porcelain 存 `ui/w8/state-porcelain.txt`）。
- 2026-10-15 范围外发现（在案）：providers「添加连接」弹窗 4 条 axe 违规（button-name / label / select-name / color-contrast；不在关键路由清单内）；拟收口批次小修。
- 待用户决策：F-1 处置（A 类判据调整 or 修复）；driver 3.3 提交授权；收尾归档确认。
