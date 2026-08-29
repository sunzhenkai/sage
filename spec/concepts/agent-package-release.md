# AgentPackageRelease

Agent Package 的不可变发布单元,是 Release Registry 的事实主键;由 `version` 与 `id` 唯一确定。

- 为什么存在:把 Package 与 Run 解耦 — Run 永远指向某个固定 Release,而不是「最新 Package」;
- 边界:`platform/packages/agent-package-release/` 负责打包,`agent-release-registry` 负责存储与查询;
- 出现在:流程 [release-admission](../flows/release-admission.md)、实体 [AgentPackageRelease 实体](../entities/agent-package-release-record.md)、模块 [release-and-admission](../modules/release-and-admission/README.md);
- 容易混淆:不是「Agent Package」(源代码包),Release 是经过签名、审计、登记的不可变产物。
