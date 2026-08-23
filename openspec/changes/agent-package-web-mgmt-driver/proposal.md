## Why
agent-web 的 Packages 域目前只有列表、详情查看与发起运行（见 `package-management-interface` spec 与已归档 agent-package-e2e-web change）。用户无法在 web 页面完成应用包的完整管理生命周期：新建一个包、更新其内容并发布新版本、上传源包文件、删除不再使用的包。当前登记/上传只能靠 CLI 脚本（`register-package.ts`）或 curl 完成，web 页面没有入口。

## What Changes
- 本 change 是 taskflow driver，不直接改代码，只编排子 change

## Non-goals
- 不做包内容在线编辑（manifest 等以源文件上传/登记为准，编辑器不属于本任务）
- 不做 active pointer / channel / rollback 治理 UI（release 发布策略治理另行立项）
- 不改变包详情页既有的发起运行、资产预览与 release 历史展示行为
- 不引入第三方上传/表单依赖，沿用现有 React + fetch 风格

## 涉及面
| 仓库 | 角色 | 说明 |
|------|------|------|
| . | 必须 | 会修改 platform/apps/agent-web，必要时扩展 platform/apps/agent-api 与 openspec specs，实施前切任务分支 |

## 验收标准
- [ ] web 包列表页提供「新建包」入口，可创建新包（填写基本元信息，空源可后续上传）
- [ ] web 支持上传源包文件并登记为 release（新建与更新均可），登记后版本化可见
- [ ] web 包详情页提供「更新包/上传新版本」入口，提交后 release 历史新增版本
- [ ] web 提供「删除包」操作，删除有确认与结果反馈，删除后列表消失
- [ ] 后端具备必要的新建（占位包）与删除端点（或等价能力），且与既有注册/登记 API 风格一致
- [ ] 全仓回归与静态检查通过（typecheck/lint/build/单测；本地栈 smoke 可选）

## Driver 协议
- 本 change 无 spec 增量（`.openspec.yaml` 已设 `skip_specs: true`）
- 子 change 一律命名 `{task}-<slice>`，与本 change 同一 planning root；跨 root 时在涉及面表显式记录 root 或 store id
- 实现进度只认子 change 自己的 `tasks.md`；本文件的 checkbox 只在对应子 change 全勾且 `validate --strict` 通过后才勾
- 涉及面里角色为 `必须` 的仓在实施前切任务分支；dirty 或 fetch 失败一律停下问用户，不自动 stash / reset / 强制切换
- 只有「checkbox 全勾」「需要用户决策」「本轮预算耗尽」三种情况允许结束一轮；单项做不了就保持未勾，在验证记录写一行原因后继续下一项
- 结束时逐条列出未勾项与原因，不按 change 汇总

## 验证记录
