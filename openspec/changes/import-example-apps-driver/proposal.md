## Why

用户希望应用页为空时能直接导入仓库内置示例应用。判据原文：应用页可从仓库内置示例中导入一个示例应用，导入成功后应用列表和详情可用；重复导入同名示例时明确提示已存在且不覆盖；typecheck、build 与相关测试通过。

方案指针：`tasks/ongoing/import-example-apps/design/import-example-apps.md`；批准：`tasks/ongoing/import-example-apps/approve/APPROVED.md`。

## What Changes

- 本 change 是 taskflow driver，不直接改代码，只编排子 change

## Non-goals

- 不做任意文件/压缩包上传、示例编辑、删除或覆盖
- 不新增服务端导入接口
- 不改 mock 写操作语义

## 涉及面
| 仓库 | 角色 | 说明 |
|------|------|------|
| . | 必须 | `platform/apps/agent-web` 页面、API 封装、构建脚本与本地化；复用 `platform/apps/agent-api` 既有接口 |

## 验收标准
- [x] 应用页可从仓库内置示例中导入一个示例应用，导入成功后应用列表和详情可用；重复导入同名示例时明确提示已存在且不覆盖；typecheck、build 与相关测试通过。

## Driver 协议
- 本 change 无 spec 增量（`.openspec.yaml` 已设 `skip_specs: true`）
- 子 change 一律命名 `{task}-<slice>`，与本 change 同一 planning root；跨 root 时在涉及面表显式记录 root 或 store id
- 实现进度只认子 change 自己的 `tasks.md`；本文件的 checkbox 只在对应子 change 全勾且 `validate --strict` 通过后才勾
- 切任务分支只针对涉及面里角色为 `必须` 的修改仓，且本身可选；task 所在仓不是修改仓时不切。修改仓干净：先 fetch 默认分支，再从其最新提交 `git switch -c`（分支已存在则 `git switch`）。修改仓 dirty：不动用户的改动，不得 stash / reset / 强制切换；用 `git switch -c` 带着这些改动切到新任务分支（git 只是带过去，文件不变），并一句话说明「你手上有未提交改动，我没动它们，带着切到了任务分支」，记入 `TASK.md`「已做决定」。未提交改动与本任务要改的文件重叠，或 git 拒绝、切错仓时才停下，说明是哪些文件
- 只有「checkbox 全勾」「需要用户决策」「本轮预算耗尽」三种情况允许结束一轮；单项做不了就保持未勾，在验证记录写一行原因后继续下一项；「需要用户决策」只停依赖该项的条目，其余条目继续
- 结束时在验证记录逐条列出未勾项与原因，不按 change 汇总；对用户按 user-report 四行说，不报编号

## 验证记录
- 2026-10-20：`check_handoff.py` exit 0；driver 脚手架建立，待 propose 子 change。

- 2026-10-20：子 change `import-example-apps-import-flow` 全部勾选，`openspec validate --strict` 通过。
- 验证（当前工作树，未提交）：`pnpm --filter @sage/agent-web typecheck` exit 0；`pnpm --filter @sage/agent-web build` exit 0，`dist/examples/ai-apps/{finance-briefing,github-trending,lifecycle-probe}/app.yaml` 均存在；`pnpm vitest run apps/agent-web/src/lib` 8 files / 59 tests passed；`pnpm vitest run apps/agent-api/src/apps-api.test.ts` 12 tests passed。
- 运行态（本地 agent-api，`http://127.0.0.1:9631/apps?lang=zh-CN`）：首次导入 `finance-briefing` 成功（5 个源文件），列表与详情可见（截图 `/tmp/sage-import-finance-briefing-success.png`、`/tmp/sage-import-finance-briefing-detail.png`）；再次导入同名示例显示“已存在，未做任何修改”（截图 `/tmp/sage-import-exists.png`）；浏览器 console 无异常。
- 运行态发现并记录：服务端应用软删除后同 ID 不能再创建（`APP_ALREADY_EXISTS`），为验证临时删除 `lifecycle-probe` 后导入会显示“服务端已有同 ID 应用但当前列表未显示”，不覆盖、不误报成功；这是既有服务端语义，不在本任务重构范围。
- 未勾项：3.3 提交（等待用户逐字授权）。
