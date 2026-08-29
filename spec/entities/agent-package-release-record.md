# AgentPackageRelease 记录

`agent_package_releases` 表。一句:Release Registry 的不可变发布记录。

- 关键字段:`package_id`、`version`、`content_hash`、`signature`、`submitted_at`、`accepted_by`、`state`;
- 关系:1 Release → N AgentRun(引用同一个 release_id);
- 读写:agent-release-registry(读写),agent-package-release(打包与签名);
- 不变式:`(package_id, version)` 唯一;`content_hash` 必须与上传 blob 一致;`state` ∈ {`submitted`, `accepted`, `rejected`, `retired`};
- 失败态:拒绝时记录 `rejection_reason`;Retire 后不能再被 Run 引用;
