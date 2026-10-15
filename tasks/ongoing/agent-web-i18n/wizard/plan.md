# 任务方案：agent-web 多语言（中/英）

## 目标

给 agent-web 控制台（`platform/apps/agent-web/`）增加中文 + 英文双语支持：按浏览器语言自动推断（默认英文），设置页可手动切换并持久化；覆盖全部界面文案与本地化格式化。配套：服务端未命名会话搜索回退默认改为英文，前端会话查询携带当前 locale。

## 完成判据

agent-web 全量界面文案随浏览器语言自动显示中文或英文（zh* → 中文；其余含无匹配 → 英文），设置页可手动切换并持久化；中英文两态下关键路由在 1280x800 与 375x812 渲染可用且 axe 无 serious/critical，typecheck / build（含 check:design）/ lint / test 全部通过。

## 交付标准

- 语言推断：zh* → zh-CN；en* → en；无匹配 / 不可读 → en；`?lang=<locale>` 覆盖（不持久化）；单测覆盖优先级与回退。
- 词典完整：en 为源（as const 供类型）、zh-CN 键位对齐（vitest 断言）；全部用户可见文案走 `t()`（导航、页头、按钮、表单、占位、空态、错误、提示、aria-label、tooltip）；无残留硬编码英文文案（提取清单 + 抽查）。
- 格式化：`formatTime` / `relativeTime` / 图表日期轴随当前语言（Intl locale 映射）；相对时间单位词入词典。
- 设置：Appearance 增「Language：Auto / English / 中文」；持久化于 `sage.agent-web.settings`；切换即时生效；`document.documentElement.lang` 同步；`index.html` 默认 `lang="en"`。
- 服务端：`normalizeHistoryLocale` 默认 `en`（chat-domain 单测更新）；`listSessions` 查询带 locale 并入 query key。
- 工程门：agent-web typecheck / build（含 check:design）/ 平台 lint / test 全过；新增单测绿。
- 文档：`platform/apps/agent-web/README.md` 增补 i18n 说明（检测规则、默认、切换、`?lang=`）。
- 运行态证据：本地 stack（或 `?mock=1`）下 `ui_evidence_check.py`：关键路由 × 中英双语 × 1280x800 / 375x812，axe 无 serious/critical；report 落 `platform/.evidence/agent-web-i18n/`；未覆盖项按 B 类显式降级登记。

## 交付类别与门包

- 交付类别：Web UI
- 适用门包：taskrail/references/gate-packs.md「Web UI」
- 基准物：WCAG 2.2 AA（axe 地板）+ 交付仓现有设计约束（DESIGN.md + `pnpm check:design`，adopt-only）+ 本任务词典（en 为准）与键位对齐测试。禁止以外部产品 / 参考实现为验收基准。
- 未覆盖即降级：axe / 视口项未跑 → B 类显式降级；Active Instance 缺位 → adopt-only（simple 档）登记并确认。

## Active Instance（Web UI）

- 状态：缺失（agent-web 无 `design-system/v1`；simple 档 adopt-only 候选）
- 根路径：无
- contract digest：无
- binding digest：无
- projection digest：无
- 前置动作：adopt-only——沿用现有组件库 / 样式体系（shadcn 风格组件 + DESIGN.md + `check:design`），质量画像登记显式降级（approve 确认）。

## 前提

- 事实：
  - agent-web 无任何 i18n 依赖；文案全量硬编码英文（40 tsx + 10 ts；`placeholder` / `aria-label` / `title` / `description` / JSX 文本共数百条）。
  - `index.html` `lang="zh-CN"` 与界面语言不一致（遗留），需改为随语言动态设置。
  - 服务端 locale 仅 chat-domain（`GET /v1/chat/sessions` 可选 `locale`，默认回退 zh-CN）；前端未传。
  - 平台 vitest（根 `pnpm test`）默认收集 `**/*.test.ts`；python playwright 已装；axe-core 未装；`platform/.evidence/` 已 gitignore。
  - sage 无 `openspec/`，CLI 向上误解析到 `/home/wii/code` → propose 前须在 sage 根初始化。
- 假设：「默认英文」= 推断不到 / 不支持的语言一律英文；zh* 全变体映射简体 zh-CN（grill 确认）；手动切换为已确认能力。

## 质量属性

- 观感：两语下无破版 / 截断 / 溢出（两视口断言 + 双语截图）；排版规范——中英混排时英文词两侧留半角空格、中文标点全角。
- 可维护性：typed keys（编译期查漏）+ en/zh 键位对齐单测；文案集中 `locales/`。
- 无障碍：axe 无 serious/critical；`html lang` 随语言正确（屏幕阅读）。
- 性能：零运行时依赖、无额外请求；切换语言不重载页面。

## 流程总览

1. 语言核心 `src/lib/i18n.ts` — 要点：Locale / LanguagePref 类型、`resolveLocale(navigator)`、`?lang=` 覆盖、`t(key, params)` 插值、订阅式当前语言、html lang 同步；验证：新增 vitest 绿。
2. 词典 — 要点：`locales/en.ts`（源）+ `locales/zh-CN.ts`；键位对齐测试；验证：对齐测试绿。
3. 文案提取 — 要点：pages（9）+ layout（nav / command-palette / settings-shell / app-shell）+ bui/* + ui/* + utils（相对时间）；验证：抽查无残留 + 逐页走查。
4. 设置与切换 — 要点：settings 增 `language: 'auto'`；Appearance 增 Language 行；切换即时生效并持久化；验证：刷新持久 + `document.lang` 正确。
5. 服务端配套 — 要点：`normalizeHistoryLocale` 默认 en + 单测；`listSessions({locale})` + query key；验证：chat-domain 测试绿；zh 界面搜「未命名」命中。
6. 工程门 — 要点：typecheck / build（check:design）/ lint / test；验证：全部 exit 0。
7. 运行态证据 + 文档 — 要点：ui_evidence_check 双语两视口 + axe；README 更新；验证：report exit 0（或 B 类登记）。

## 阻塞点

- 无。

## 坑 / 注意事项

- openspec：sage 未初始化且 CLI 向上解析 → propose 前在 sage 根 `openspec init --tools none`；此后所有 openspec 命令须在 sage 内执行。
- axe-core 需补（agent-web devDependency 或 `--axe-path`）。
- 中文字长与英文不同 → 两视口断言必须真实跑（375x812 最易破）；不借机改版式。
- `relativeTime` 等非组件路径取语言 → i18n 模块须支持组件外读取（同 `settings.ts` 的 useSyncExternalStore 模式）。
- 服务端默认变更影响 cursor filter hash（并入 filter 语义）→ 单测同步改，明确不兼容旧默认。
- 简单档跳过 design → 实现细节以本方案 + driver goal 原文承载；实现中发现要引依赖 / 动共享面 → 回确认协议。
- 非目标边界：mock 数据、服务端错误文案、英文既有文案（原样提取）、URL 路由式 locale、第三种语言。
- zh 未命名会话显示文案取「未命名对话」（与服务端 zh 回退一致）；en 两端保持现状。
- 授权清单（一次性，接受即放行）：建 `tasks/`、openspec init、加 axe-core devDep、改 agent-web 与 chat-domain 代码、跑本地服务与证据。逐步授权：commit / push / 部署 / 对外发送。

## 风险点

- 词典漏译 / 术语漂移 → 键位对齐测试 + 术语表 + 中文全量走查。
- 翻译风格分歧 → 关键术语本轮 grill 确认，其余按术语表与文体规范执行，验收可改。
- adopt-only 降级 → 后续 UI 任务若升 medium 需补建 Active Instance（已在质量画像登记）。

## 不做的事

- 不建 Active Instance、不引第三方 i18n 依赖、不加第三种语言。
- 不本地化服务端错误文案与 mock 数据；不改英文既有文案；不做 URL 路由式 locale。
- 不 commit / push / 部署（未经逐步授权）。

## 建议路由

简单（simple）：改动面广但为机械文案替换，零新设计表面、无逻辑重塑；按「拿不准往简单靠一档」定档，启动 adopt-only 显式降级。备选 medium（须先建 `design-system/v1` Active Instance 至 freeze）已评估并放弃（2026-10-15 闸口确认）。
