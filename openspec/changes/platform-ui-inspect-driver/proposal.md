## Why
基于 dotf-ui-design 对 platform 前端应用（agent-web）现有页面做 ui-inspect 空间细节检查，确认后走优雅重构。

## What Changes
- 本 change 是 taskflow driver，不直接改代码，只编排子 change

## Non-goals
- 不做整站换肤、不重建设计 token、不换组件库
- 不引入新的组件库或 Tailwind（项目没有则不引入）
- 不拦截 pretty-view-html / pretty-view-ppt 路径的页面

## 涉及面
| 仓库 | 角色 | 说明 |
|------|------|------|
| . | 必须 | 会修改，实施前切任务分支 |

## 验收标准
- [x] agent-web 现有页面完成 ui-inspect 空间细节检查，产出检查清单
- [x] 检查结论经用户确认后完成优雅重构，改动走项目既有 token / 组件，不造平行实现
- [x] 重构后页面经截图验收，与检查清单逐条对应
- [x] 状态齐全（hover / focus / active / disabled / loading / empty / error），窄屏不溢出

## Driver 协议
- 本 change 无 spec 增量（`.openspec.yaml` 已设 `skip_specs: true`）
- 子 change 一律命名 `platform-ui-inspect-<slice>`，与本 change 同一 planning root；跨 root 时在涉及面表显式记录 root 或 store id
- 实现进度只认子 change 自己的 `tasks.md`；本文件的 checkbox 只在对应子 change 全勾且 `validate --strict` 通过后才勾
- 涉及面里角色为 `必须` 的仓在实施前切任务分支：没有则 `git switch -c`，已有则 `git switch`。不许 stash / reset / 强制切换。工作树 dirty 时：未提交路径仅含当前 task 的 OpenSpec change（`openspec/changes/platform-ui-inspect-*`）则直接切；否则列出路径并确认是否继续 checkout。用户不同意、git 拒绝或切错仓时停下
- 只有「checkbox 全勾」「需要用户决策」「本轮预算耗尽」三种情况允许结束一轮；单项做不了就保持未勾，在验证记录写一行原因后继续下一项
- 结束时逐条列出未勾项与原因，不按 change 汇总

## 验证记录
- 2026-08-30 检查（子 change `platform-ui-inspect-check`）：服务 9610/9611/9612 实测正常未重启；16 张截图取证（桌面 1440 + 窄屏 375），产出 `report.md`，发现 P0×2 / P1×2 / P2×2；`validate --strict` 通过
- 2026-08-30 重构（子 change `platform-ui-inspect-refine`）：用户确认 P0/P1/P2 全修；6 条全部修复并逐条截图复检 pass（坐标实测见 `refine-plan.md`）；`pnpm --filter @sage/agent-web typecheck` 通过；platform 根 `pnpm test` 2 failed / 1037 passed，2 个失败为既有且与本次无关（`scripts/agent-platform-final/final.test.ts` 断言的 evidence 文件改动前已 dirty；`examples/node-host` live provider budget，不 import agent-web）；`validate --strict` 通过
- 2026-08-30 收尾回归：`corepack pnpm exec tsc -b --pretty false` 退出码 0
- 已知遗留：`platform/evidence/**` 有测试运行再生成的 dirty 文件（非本任务改动，不随本次提交）；schedules 正常列表态因服务端缺 `SAGE_SERVICE_TOKEN` 未取证，补查留待后续
