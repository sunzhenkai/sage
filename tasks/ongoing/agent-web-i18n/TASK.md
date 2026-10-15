---
slug: agent-web-i18n
status: handed-off
phase: propose
confirm_mode: human
tier: simple
criterion: "agent-web 全量界面文案随浏览器语言自动显示中文或英文（zh* → 中文；其余含无匹配 → 英文），设置页可手动切换并持久化；中英文两态下关键路由在 1280x800 与 375x812 渲染可用且 axe 无 serious/critical，typecheck / build（含 check:design）/ lint / test 全部通过。"
driver: agent-web-i18n-driver
evidence_root: platform/.evidence/agent-web-i18n
created: 2026-10-15
updated: 2026-10-15
handed-off: 2026-10-15
---

# agent-web 多语言（中/英）

## 目标

- agent-web 控制台支持中文 + 英文：按浏览器语言自动推断（默认英文），设置页可手动切换并持久化；覆盖全部界面文案与本地化格式化。
- 配套服务端：未命名会话搜索回退默认改为英文；前端会话查询携带当前 locale。

## 非目标

- 不建 `design-system/v1` Active Instance（simple 档 adopt-only，登记显式降级）。
- ~~不本地化服务端 API 错误文案（英文原样显示）~~、mock 伪造数据、代码注释与仓库文档（agent-web README 除外）。（**已作废** 2026-10-15：服务端错误码改为客户端本地化，见 D-4 与 change `agent-web-error-localization`；mock 数据与服务端非文案内容仍保持原样。）
- 不做 URL 路由式 locale（无 `/zh/` 前缀）；不加第三方语言。

## 现状

- agent-web（`platform/apps/agent-web/`）：40 个 tsx + 10 个 ts，无任何 i18n 依赖；用户可见文案全量硬编码英文；`index.html` 遗留 `lang="zh-CN"`。
- 设置存 `sage.agent-web.settings`（localStorage，`src/lib/settings.ts`）；主题 / 侧边栏 / 快捷键均有先例。
- 服务端 locale 仅 `packages/chat-domain/src/history.ts`：`untitledTitleForLocale`（en / zh-CN）+ `normalizeHistoryLocale`（默认 zh-CN）；`GET /v1/chat/sessions` 可选 `locale` 参数（契约 maxLength 35）；前端未传递。
- 测试：平台根 `pnpm test`（vitest，默认收集 `**/*.test.ts`）；agent-web 已有 `src/lib/provider-autofill.test.ts` 先例。
- sage 仓无 `openspec/`，openspec CLI 会向上解析到 `/home/wii/code` → propose 前须在 sage 根初始化。
- 环境：python playwright 已装；axe-core 未装（证据前需补）；`platform/.evidence/` 已被 gitignore。

## 方案

（wizard 定稿 2026-10-15；细则见 `wizard/plan.md`；术语与文体见 `glossary.md`；已冻结并交接）

- 完成判据：见元信息 `criterion`（原文）。
- 显式降级：已确认并固化——见 `approve/APPROVED.md`「显式降级」（2 条，2026-10-15 confirmed）；副本见下「交接」节。
- 事实：见「现状」。
- 假设：「默认英文」= 推断不到 / 不支持的语言一律英文；zh* 全变体（含 zh-TW/zh-HK）映射简体 zh-CN（已确认）。
- 质量属性：观感——两语无破版 / 截断（两视口断言）；可维护性——typed keys + en/zh 键位对齐单测；无障碍——axe 无 serious/critical、`html lang` 正确；性能——零运行时依赖。
- 流程总览：
  1. 语言核心 `src/lib/i18n.ts`（检测 / `?lang=` 覆盖 / 插值 / 订阅 / html lang）+ 单测 — 验证：vitest 绿
  2. 词典 `locales/en.ts`（源）+ `locales/zh-CN.ts` + 键位对齐测试 — 验证：对齐测试绿
  3. 全量文案提取（pages / layout / bui / ui / utils）— 验证：抽查无残留硬编码 + 逐页走查
  4. Settings Language 行（Auto / English / 中文）+ 即时切换与持久化 — 验证：刷新持久、`document.lang` 同步
  5. 服务端默认 en + 前端会话查询带 locale — 验证：chat-domain 单测绿、zh 界面搜「未命名」命中
  6. 工程门 typecheck / build / lint / test — 验证：全部 exit 0
  7. 运行态证据（ui_evidence_check 双语两视口）+ README 更新 — 验证：report exit 0（否则按确认协议处理）
- 阻塞点：无。
- 坑：见 `wizard/plan.md`「坑 / 注意事项」（openspec 初始化、axe-core 补装、中文字长、非组件取语言、服务端 hash 变更等）。
- 回退：未交接前方案可改；实现期若需引入依赖或动共享面 → 回 taskrail 走确认协议。

## 进展

- 2026-10-15：只读摸底完成；用户确认合并闸口「按推荐」：建 `tasks/` 台账、任务 `agent-web-i18n`、simple + adopt-only、自研 typed 词典、Settings 语言项、服务端默认改 en。
- 2026-10-15：wizard 定稿落盘 `wizard/plan.md`；进入 explore。
- 2026-10-15：explore（grill 一轮）收敛，用户「同意」：Q1 zh* 全变体 → 简体 zh-CN；Q2 术语表与文体约定整表通过（固化 `glossary.md`）；Q3 服务端错误消息原样英文显示（README 记已知边界）；Q4 zh 标签页标题「Sage 智能体控制台」。
- 2026-10-15：approve 轻量通过（结构门通过；显式降级 2 条 confirmed），`approve/APPROVED.md` 与 `design/contract.md` 已写。
- 2026-10-15：handoff 完成——driver `agent-web-i18n-driver` 已建；本任务进度此后只认 taskflow checkbox（`tasks/` 不再勾交付进度）。
- 2026-10-15：本任务**非目标作废**（服务端错误文案本地化）。起因：中文界面出现「请求失败。Provider connection is referenced by run agent settings; clear the reference before deleting」中英混排；用户决策：改掉该边界，全部 `sendError` code（含透传族）做客户端 code→文案映射，动态细节保留英文 detail 作次要文字；落地 change `agent-web-error-localization`。

## 决策

- D-1 采纳：simple + adopt-only + 自研 typed 词典 + Settings 语言项（Auto / English / 中文）+ 服务端默认 en 且前端传 locale — 主因：改动面广但机械、零新设计表面；见 2026-10-15 闸口「按推荐」。
- D-2 grill 收敛（2026-10-15）：zh* 全变体 → 简体；术语与文体以 `glossary.md` 为准；服务端错误消息原样英文展示；zh 标签页标题「Sage 智能体控制台」。
- D-3 冻结（2026-10-15）：approve 通过（轻量）；显式降级 2 条 confirmed；唯一出口 handoff 已执行。
- D-4 边界变更（2026-10-15，supersedes D-2 中「服务端错误消息原样英文展示」）：登记在 `error-codes.ts` 清单中的服务端错误码改为客户端本地化渲染——精确 code → 最长族前缀 → 未登记 code 回退服务端英文；带运行时信息的 code 保留英文 detail 作次要文字。agent-api 的 `sendError` 文案不改（服务端仍为英文），故非破坏性接口变更。落地 change：`openspec/changes/agent-web-error-localization`（已实现，工程门全绿）。
- 设计依据（简单档从轻）：自研词典 → 最小依赖原则（项目零依赖自研风格）→ 选型不引外部依赖、可测（键位对齐单测）；服务端 locale 复用既有查询参数，不改契约。
- 取舍：不建 Active Instance（接受设计系统证据按 simple 档降级）；不引 react-i18next（接受自研成本，换零依赖与编译期查漏）。
- 带进实现的未决：openspec 初始化（`openspec init --tools none`，sage 根）；axe-core 安装方式（devDep 或 `--axe-path`）。
- 回退：词典与 i18n 模块可局部替换不影响其他模块；服务端默认变更可单行回退。

## 交接

- 交付类别：Web UI
- 适用门包：gate-packs.md「Web UI」（simple 档调度 + adopt-only）
- Active Instance 根路径：不适用（adopt-only，simple 档）
- contract digest：不适用（adopt-only）
- binding digest：不适用（adopt-only）
- projection digest：不适用（adopt-only）
- adopt-only 显式降级原文（逐字，confirmed 2026-10-15）：
  1. 维度：设计系统基线 / 定级：B 类 / 默认期望：Web UI 交付应有 frozen `design-system/v1` Active Instance / 实际选择：adopt-only——沿用现有组件库与样式体系（DESIGN.md + `check:design`），豁免 Active Instance / 原因：simple 档机制；本任务零新设计表面 / 回滚说明：后续 UI 任务补建 `design-system/v1` 至 freeze / 确认状态：confirmed（2026-10-15 用户「按推荐冻结并交接」）。
  2. 维度：重型证据门调度 / 定级：B 类 / 默认期望：medium/complex 硬门（`ui_evidence_check` + design 评审文件）/ 实际选择：`ui_evidence_check` 照计划执行；design 评审文件不设 / 原因：simple 档调度（SHOULD）/ 回滚说明：需要时补 design 评审文件并复验 / 确认状态：confirmed（2026-10-15 用户「按推荐冻结并交接」）。
- driver：`agent-web-i18n-driver`
- 采纳方案：simple + adopt-only + 自研 typed 词典（指针：`wizard/plan.md`、`glossary.md`）
- 指针：`design/contract.md`（契约指针与证据计划）、`approve/APPROVED.md`（冻结结论与降级原文）
- 可带进实现的未决：openspec 初始化（`openspec init --tools none`，sage 根）；axe-core 安装方式（devDep 或 `--axe-path`）。
- 证据要求：`ui_evidence_check.py`（关键路由 × 双语 × 两视口，axe 无 serious/critical）report exit 0；未覆盖按 B 类登记。

## 未决问题

- [ ] 无（译词与文体已固化 `glossary.md`；执行期未决随交接进入 driver 准备段 / 对应切片前置）。

## 下一步

- 交付侧：`agent-web-i18n-driver`（propose → apply → archive；进度只认 checkbox；taskflow 入口门已过）。
- 探索侧：本任务留在 `ongoing/`（handed-off），可 `resume` 查看方案 / 决策 / 交接记录。
