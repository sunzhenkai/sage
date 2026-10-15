# APPROVED — agent-web-i18n

- 结论：批准冻结并交接（2026-10-15；human 轻量 approve，用户确认「按推荐冻结并交接」）。
- 方案指针：`../wizard/plan.md`（完成判据原文、流程总览、交付类别与门包、Active Instance adopt-only 节）；术语与文体：`../glossary.md`。
- 交付类别：Web UI
- 适用门包：taskrail/references/gate-packs.md「Web UI」（simple 档调度 + adopt-only）
- 结构门：通过——判据逐项可检查（运行态 + 命令输出）；非目标清晰；选型依据（自研词典 → 最小依赖；服务端复用既有 `locale` 参数、不改契约）。
- 评审门：简单档轻量，未另设评审文件（已登记为降级 2）。
- 评审意见路径：无（轻量）。

## adopt-only 最小画像登记（gate-packs「Web UI」simple 档）

- 受众与场景：本机 / 局域网开发者经浏览器使用 agent-web 控制台（中 / 英双语界面）。
- 规模与运行假设：单用户 / 小团队本机场景；无并发与数据量新增假设（纯前端文案与格式化改动）。
- 页面/主流程：概览、对话（含会话搜索）、任务、定时任务、应用、发布包、供应商、设置（Appearance 切换语言）——每页入口到可用状态。
- 角色底线：
  - product：语言自动推断 + 手动切换可用；不改动既有功能语义。
  - design：沿用现有组件库与 DESIGN.md；两语无破版；`check:design` 通过；axe 无 serious/critical。
  - engineer：typecheck / build / lint / test 全过；词典键位对齐；服务端默认变更单测覆盖。

## 显式降级（原文，已 confirmed）

1. 维度：设计系统基线 / 定级：B 类 / 默认期望：Web UI 交付应有 frozen `design-system/v1` Active Instance / 实际选择：adopt-only——沿用现有组件库与样式体系（DESIGN.md + `check:design`），豁免 Active Instance / 原因：simple 档机制；本任务零新设计表面 / 回滚说明：后续 UI 任务补建 `design-system/v1` 至 freeze / 确认状态：confirmed（2026-10-15 用户「按推荐冻结并交接」）。
2. 维度：重型证据门调度 / 定级：B 类 / 默认期望：medium/complex 硬门（`ui_evidence_check` + design 评审文件）/ 实际选择：`ui_evidence_check` 照计划执行；design 评审文件不设 / 原因：simple 档调度（SHOULD）/ 回滚说明：需要时补 design 评审文件并复验 / 确认状态：confirmed（2026-10-15 用户「按推荐冻结并交接」）。

## 未决（可带进实现）

- openspec 初始化方式（`openspec init --tools none`，sage 根）——handoff 执行时处理。
- axe-core 安装方式（agent-web devDependency 或 `ui_evidence_check --axe-path`）。

## 下一步

- handoff（唯一出口）。
