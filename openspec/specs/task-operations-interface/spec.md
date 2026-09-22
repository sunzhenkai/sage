# task-operations-interface Specification

## Purpose
TBD - created by archiving change sage-p6-chat-task-reconciliation-and-e2e. Update Purpose after archive.
## Requirements
### Requirement: Snapshot-bound Task operations interface

Local runtime SHALL通过API composition root和使用固定local Namespace/Task Queue的真实Temporal Worker暴露authorized Signal、Cancel与Retry，且不得接受request-side target override。

#### Scenario: User cancels a Task
- **WHEN**authorized user在Task detail选择Cancel
- **THEN**service解析stored Target Snapshot并向该target发送cancellation


#### Scenario: Local promotion reaches a Worker
- **WHEN**authenticated local principal promote一个persisted Chat Message且local stack healthy
- **THEN**API routing持久化immutable target snapshot，fixed local Worker完成Task，且不接受endpoint、Namespace或Task Queue override






#### Scenario: Task payload boundary
- **WHEN**client执行Task create、signal、cancel或retry
- **THEN**strict schema拒绝provider、model、profile、base URL、API key、target、endpoint、namespace、actor或roles字段

