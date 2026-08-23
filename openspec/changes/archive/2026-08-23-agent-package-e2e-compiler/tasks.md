# agent-package-e2e-compiler Tasks

## 1. 编译器实现

- [x] 1.1 实现资产 lock 结构：相对路径排序清单 + 每文件 sha256 + 总 lockDigest（canonical JSON）
- [x] 1.2 实现编译主流程：源包校验结果 → 组装 `AgentPackageRelease.v1`（packageId/version/digests/compatibility engineIds）并通过 `isAgentPackageRelease` 校验
- [x] 1.3 实现确定性占位 provenance：compilerRef/digest/build（local-dev）、sourceDigest、lockDigest、sbom/signature/attestation 占位 digest 与 refs（由 lock 内容派生，可复现）

## 2. 测试与验证

- [x] 2.1 单测：合法编译、重复编译字节级一致、资产/manifest 变更改变 contentDigest 与 lockDigest、schema 校验通过
- [x] 2.2 包级 lint/test 通过；`openspec validate --strict --type change agent-package-e2e-compiler` 通过
