# 契约指针（agent-web-i18n）

- 交付类别：Web UI
- 共享面契约：不适用——simple 档 adopt-only（豁免 Active Instance）；沿用 agent-web 现有组件库 / 样式体系，设计约束由交付仓既有 `DESIGN.md`（`platform/apps/agent-web/DESIGN.md`）与 `pnpm --filter @sage/agent-web check:design` 承载。
- Active Instance 根路径：不适用（adopt-only，simple 档）
- contract digest：不适用（adopt-only）
- binding digest：不适用（adopt-only）
- projection digest：不适用（adopt-only）
- adopt-only 显式降级原文：见 `../approve/APPROVED.md`「显式降级」（2 条，confirmed）；逐字副本已随交接写入 `../TASK.md`「交接」节与 driver `proposal.md`。
- 证据计划：
  - manifest（随交付仓保存、可复跑）：`platform/evidence/agent-web-i18n/ui-manifest.json`
  - 运行产物：`platform/.evidence/agent-web-i18n/ui/<run>/report.json` + PNG（`.evidence` 为 gitignore 区）
  - 覆盖：关键路由 × 中英双语 × 1280x800 / 375x812；axe WCAG 2.2 AA 无 serious / critical；四态按可复现性覆盖、不适用项写 manifest `not_applicable` 理由
  - 未跑 / 未覆盖项按 B 类显式降级登记（criterion 内含 axe 与视口项，属计划执行项）
