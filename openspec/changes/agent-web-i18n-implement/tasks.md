# Tasks

## 1. i18n 核心与词典骨架

- [x] 1.1 实现 `src/lib/i18n.ts`（Locale / LanguagePref 类型；resolveLocale 按 navigator.languages 顺序 zh*→zh-CN 其余→en；`?lang=` 归一化覆盖且不持久化；`t(key, params)` 插值；订阅式当前语言（同 settings.ts 模式，支持组件外读取）；`document.documentElement.lang` 同步）；验证：`pnpm --filter @sage/agent-web typecheck` 通过
- [x] 1.2 新增 `src/lib/i18n.test.ts` 覆盖检测优先级 / 无匹配回退 / 插值 / `?lang=` 覆盖；验证：`pnpm vitest run apps/agent-web/src/lib/i18n.test.ts` 绿
- [x] 1.3 建立 `src/lib/locales/en.ts`（as const 源）与 `src/lib/locales/zh-CN.ts` 骨架（common / nav 基础键）+ 键位对齐测试；验证：对齐测试绿 + typecheck 绿

## 2. 页面文案提取

- [x] 2.1 迁移 pages 第一批（overview / apps / packages / settings / not-found）文案到词典并接 `t()`；验证：typecheck 绿 + zh / en 两态逐页走查无破版
- [x] 2.2 迁移 pages 第二批（chat / tasks / schedules / providers）文案到词典并接 `t()`；验证：typecheck 绿 + zh / en 两态逐页走查（含空态与错误提示）
- [x] 2.3 迁移 layout 与 ui 组件（nav / command-palette / settings-shell / app-shell / page；button / dialog / combobox / misc / table 等）文案；验证：typecheck 绿 + 走查（含命令面板、快捷键页）
- [x] 2.4 迁移 bui 组件（session-list / prompt-bar / atoms / records-table / task-rows / thinking / tool-chips / insight-cards / code-block / flowchart / approval-card / loading-state / streaming-text 等）文案；验证：typecheck 绿 + 走查
- [x] 2.5 残留扫描：抽查 `src` 无未迁出的用户可见英文文案（允许项：数据 / mock / 代码标识符）；验证：扫描命令输出留档到 driver 验证记录

## 3. 格式化与设置切换

- [x] 3.1 `src/lib/utils.ts` formatTime / relativeTime 与图表日期轴随当前语言（Intl locale + 词典单位词）；验证：新增或扩展单测绿 + zh / en 走查
- [x] 3.2 settings store 增 `language: 'auto' | 'en' | 'zh-CN'`（默认 auto）并在 Settings → Appearance 新增 Language 行（Auto / English / 中文）；验证：手测（切换即时生效、刷新持久、Auto 重读浏览器语言、`html lang` 同步）
- [x] 3.3 `index.html` 默认 `lang="en"` 与启动时 html lang 同步逻辑；验证：走查（en 默认下 DOM lang 正确、zh 下为 zh-CN）

## 4. 服务端 locale 配套

- [x] 4.1 `packages/chat-domain/src/history.ts`：`normalizeHistoryLocale` 默认改 `en`；更新 `src/history.test.ts`；验证：`pnpm vitest run packages/chat-domain/src/history.test.ts` 绿
- [x] 4.2 agent-web `api.listSessions` 增 `locale` 参数并接入会话列表查询（query key 含 locale）；验证：typecheck 绿 + zh 界面搜「未命名」命中（本地 stack 或 mock 手测）

## 5. 集成验证、证据与文档

- [x] 5.1 落 `platform/evidence/agent-web-i18n/ui-manifest.json`（关键路由 × 双语 × 1280x800 / 375x812；四态可复现者覆盖、不可复现写 `not_applicable` 理由）；验证：`ui_evidence_check.py --validate-only` 通过
- [x] 5.2 运行 agent-web（含 stack 或 `?mock=1`）跑 `ui_evidence_check.py` 产 `platform/.evidence/agent-web-i18n/ui/<run>/report.json` 且 exit 0（axe 无 serious / critical；焦点可见）；验证：report 落盘并记入 driver 验证记录
- [x] 5.3 `apps/agent-web/README.md` 增补 i18n 说明（检测规则、默认英文、切换、`?lang=`、服务端错误为英文的已知边界）；验证：与实现一致、含可复跑命令
- [x] 5.4 工程门全跑：平台 `pnpm lint` / `pnpm test`、agent-web `typecheck` / `build`（含 check:design）；验证：全部 exit 0，命令与结果记入 driver 验证记录
