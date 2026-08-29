# AgentPackageRelease 准入

## 背景

开发者提交一份新的 AgentPackage(代码 + 工具 + 资源);Sage 必须审计通过才能进入 Registry,被 Run 引用。

## 目标

[AgentPackageRelease 记录](../entities/agent-package-release-record.md) 进入 Registry,`state=accepted`,后续 Run 可用。

## 流程

1. 开发者 `POST /v1/agent-packages`,提交 Package;
2. `agent-package-release` 计算 `content_hash`、打签名、生成不可变产物;
3. `agent-run-admission` 校验签名、依赖、Capability、Conformance;
4. Production Governance 跑边界检查(引用、计费点、Telemetry 基数);
5. 全部通过 → `agent-release-registry` 写入 `state=accepted`;
6. 失败 → 写 `state=rejected`,附 `rejection_reason`;不进入 Registry,Run 不可引用。

## 依赖

- 上游数据:Package 制品;
- 服务:Postgres、Conformance 工具链、Production Governance 脚本;
- 前置状态:无(新 Release 即可)。

## 输出

- Release 记录;
- Registry 状态变更;
- Conformance Evidence(`evidence/agent-platform-final/`)。

## 失败

- 签名失败 → 立即拒绝;
- Conformance 失败 → 拒绝并指出失败 case;
- 边界破坏 → 拒绝,提示修复;
- 后置审计发现漏洞 → `retired`,后续 Run 需迁到新 Release。
