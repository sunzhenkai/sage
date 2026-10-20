# 批准记录

- 日期：2026-10-20
- 任务：import-example-apps
- 方案：`design/import-example-apps.md`
- 完成判据：应用页可从仓库内置示例中导入一个示例应用，导入成功后应用列表和详情可用；重复导入同名示例时明确提示已存在且不覆盖；typecheck、build 与相关测试通过。
- 结论：approve（human 模式；用户在本轮说“按复述推进”，并明确同意先出方案再实现）
- 显式降级：无（Web UI adopt-only，普通功能改动；`ui_evidence_check` 可选）
- 未决：示例清单手写三项，新增示例需同步清单（已记录，不阻断）
