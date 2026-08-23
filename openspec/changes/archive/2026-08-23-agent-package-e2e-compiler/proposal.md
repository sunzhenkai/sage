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
- [x] 编译器输出通过 `isAgentPackageRelease` schema 校验
- [x] 同内容重复编译确定性一致；任一资产变更导致 contentDigest/lockDigest 变化
- [x] provenance 占位值可复现且带 local-dev 标识
- [x] 单测与静态检查通过

## 验证记录

- `pnpm --filter @sage/agent-package-release typecheck` 通过
- `pnpm --filter @sage/agent-package-release test`：41/41 通过（compiler 6 + source-loader 12 + index 23）
- `npx eslint packages/agent-package-release/src/ --max-warnings=0` 通过
- `pnpm --filter @sage/agent-package-release build` 通过
- `openspec validate --strict --type change agent-package-e2e-compiler` 通过
- 实现说明：新增 `src/compiler.ts`（资产 lock + 编译主流程 + 确定性占位 provenance），复用既有 `buildAgentPackageLockV1/buildAgentPackageSupplyChainEvidenceV1/buildAgentPackageReleaseV1`；`compilerBuild='local-dev'`
- 顺带修复：`scanForbiddenPackageContent` 键名匹配由子串改为词边界，避免 `description` 被误判为 `script`（此前无外部消费者，无回归）
