## ADDED Requirements

### Requirement: 本地源包编译为不可变 Release
系统 SHALL 提供本地编译器将校验通过的源包目录编译为 canonical `AgentPackageRelease.v1`：计算全部资产与 manifest 的内容 digest，生成资产 lock，并以确定性方式填充 provenance 必填字段（本地占位，compilerBuild 标识 local-dev）。编译 SHALL 可复现：相同源内容重复编译产出相同 Release；任何资产或 manifest 变更 SHALL 改变 contentDigest 与 lockDigest。

#### Scenario: 编译合法源包
- **WHEN** 编译器处理一个校验通过的源包目录
- **THEN** 产出通过 Release schema 校验的不可变清单，含资产 lock 与全部 digest 字段

#### Scenario: 重复编译可复现
- **WHEN** 同一源包目录被编译两次
- **THEN** 两次产出 canonical JSON 完全一致（含占位 provenance）

#### Scenario: 内容变化改变 digest
- **WHEN** 源包内任一资产或 manifest 字段发生变更后重新编译
- **THEN** 新 Release 的 contentDigest 与 lockDigest 均不同于旧值
