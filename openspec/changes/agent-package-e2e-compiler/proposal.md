## Why
源包格式有了之后，需要把它变成运行时可信任的不可变 `AgentPackageRelease.v1`。当前仓库没有任何编译器：Release 只能手工构造，registry 也只能登记「已编译」的清单。本切片实现「目录 → 校验 → lock/digest → Release」的本地编译链。

## What Changes
- 在 `platform/packages/agent-package-release` 新增编译器：消费上一切片的源包校验结果，产出 canonical `AgentPackageRelease.v1`
- 计算 content digest（RFC 8785 canonical JSON + SHA-256，复用 agent-contracts 工具）与资产 lock
- provenance 必填字段（compiler/lock/sbom/signature/attestation）使用确定性本地占位，`compilerBuild='local-dev'`
- 编译结果确定性：同目录内容重复编译得到字节级相同的 Release

## Capabilities

### New Capabilities

（无）

### Modified Capabilities
- `agent-package-release` — ADDED「本地源包编译为不可变 Release」requirement

## Non-goals
- 真实签名/SBOM 生成与外部供应链（字段语义保留，值为占位）
- 依赖解析/network fetch（v1 源包无外部依赖，lock 只覆盖本地资产）

## 涉及面
| 仓库 | 角色 | 说明 |
|------|------|------|
| . | 必须 | platform/packages/agent-package-release、openspec specs |

## 验收标准
- [ ] 编译器输出通过 `isAgentPackageRelease` schema 校验
- [ ] 同内容重复编译确定性一致；任一资产变更导致 contentDigest/lockDigest 变化
- [ ] provenance 占位值可复现且带 local-dev 标识
- [ ] 单测与静态检查通过

## 验证记录
