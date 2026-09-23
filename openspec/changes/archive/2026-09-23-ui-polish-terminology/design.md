## Context
6 项违规集中在 i18n 词条（zh-CN.ts / en.ts）与少量视图文案点，均为字符串替换，无结构改动。`CONTEXT.md` 是用语契约的唯一真相源。

## Goals / Non-Goals
**Goals:**
- 界面（zh + en）不再出现契约避免词；同一实例只用一个名字

**Non-Goals:**
- 不重构 i18n 文件结构、不新增 key 之外的机制

## Decisions
- 全部通过 i18n 词条落地，不在视图里写字面量；新增 key 时 zh-CN / en 同步成对
- P1#10 启动成功文案以「打开 Task」为基准统一叫 Task，而不是反过来把动作改成 Run——Task 是该实例落库后的名字
- 修复后用 grep 复核避免词（conversation、`默认模型`、`AI Apps`、`>entry<`、单独 `Run`）作为机械验收

## Risks / Trade-offs
- [词条改动可能影响测试快照或断言] → 实施时同步跑 agent-web 相关检查并更新受影响断言
