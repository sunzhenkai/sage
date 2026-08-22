## ADDED Requirements

### Requirement: 包管理 HTTP 端点与编译登记
agent-api SHALL 暴露包管理端点：`POST /v1/packages/{packageId}/releases` 接受源包内容并执行「校验 → 编译 → 登记」，`GET /v1/packages` 与 `GET /v1/packages/{packageId}` 返回包列表与详情（manifest 摘要、资产清单与 digest、release 历史）。登记 SHALL 幂等：同一 releaseId 重复提交返回既有记录；非法源包 SHALL 返回稳定错误且不产生部分登记。

#### Scenario: 登记源包
- **WHEN** 客户端提交一个合法源包到 releases 端点
- **THEN** 服务端编译为 Release、登记成功并返回 releaseId 与全部 digest

#### Scenario: 重复登记幂等
- **WHEN** 同一源包（相同内容）被再次提交
- **THEN** 端点返回既有 release 记录与幂等标识，不产生第二条登记

#### Scenario: 非法源包被拒
- **WHEN** 提交的源包未通过校验（缺 manifest、危险资产等）
- **THEN** 端点返回稳定错误码与违规路径，registry 状态不变

#### Scenario: 查询包列表与详情
- **WHEN** 客户端调用列表/详情端点
- **THEN** 返回该租户可见的包摘要与 release 历史，详情含资产相对路径与 digest
