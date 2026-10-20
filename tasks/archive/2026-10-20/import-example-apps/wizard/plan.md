# 方案：在应用页导入仓库内置示例应用

## 目标

应用页为空时，用户可从仓库内置的三个示例源包中选择一个导入；导入后应用列表与详情可用。复用既有 App 登记接口，不新增服务端 API。

## 完成判据

（原文，与 `TASK.md` 一致）

应用页可从仓库内置示例中导入一个示例应用，导入成功后应用列表和详情可用；重复导入同名示例时明确提示已存在且不覆盖；typecheck、build 与相关测试通过。

## 步骤

1. 构建期暴露示例源包：开发时以 vite middleware 从 `platform/examples/ai-apps` 读取，build/preview 时把目录复制进 `public/examples/ai-apps` 对应产物 — 验证：dev 与 preview 请求示例 `app.yaml` 内容一致。
2. 前端定义示例清单与文件加载：按约定读取 `app.yaml`、prompts、references、schema 等源文件，形成 `files: Record<string, string>` — 验证：清单三个示例均能组装出与源包逐字相同的文件集合。
3. 应用页加「导入示例应用」入口：空状态主按钮 + 非空页头按钮；对话框展示示例名称/说明，导入中禁用，成功/失败可见状态 — 验证：键盘可打开/关闭，按钮与输入状态无无障碍违规。
4. 导入动作：先 `POST /v1/apps`（`name` 用示例 id），再 `POST /v1/apps/:appId/releases`；已有应用（`APP_ALREADY_EXISTS` 或列表中已存在）不覆盖，直接给出“已存在”结果 — 验证：首次导入 201/200，重复导入无 release 覆盖。
5. 刷新应用查询并进入详情或给出详情链接 — 验证：列表出现、点击可进详情、manifest 与源包一致。
6. 文档与检查：更新 agent-web README 页面接口表与本地化文案（中/英）；跑 typecheck、build、agent-api apps 测试与 agent-web 相关测试 — 验证：全部 exit 0，并记录输出。

## 不做

- 不做任意文件/压缩包上传。
- 不做示例编辑、删除或覆盖。
- 不新增服务端导入接口。

## 交付标准

- 功能：三个内置示例均可导入；重复导入不产生新 release；错误显示可理解。
- 观感：普通功能改动，沿用现有 DESIGN.md 与组件；破坏性操作不需要新增确认；对话框键盘可达、focus 可见。
- 无障碍：对话框有标题，操作有可访问名称；不引入 serious/critical axe 问题。

## 交付类别 / 门包

- 交付类别：Web UI + 服务契约复用
- 适用门包：Web UI（adopt-only，普通功能改动；`ui_evidence_check` 可选）

## 事实与假设

- 事实：`POST /v1/apps` 建应用；`POST /v1/apps/:appId/releases` 接受 `{files}`，服务端校验 `manifest.id`；应用页目前只有 GET/DELETE；示例包均在 `examples/ai-apps`。
- 假设：示例清单可写死为三个已知 id，源文件由约定文件名加载；新增示例需要同步清单（把握高）。导入后停留在应用页并刷新列表（把握高）。
- 风险：生产镜像是否包含 `platform/examples` 取决于 Dockerfile；方案要求复制到 agent-web 构建产物，因此只依赖构建上下文。回滚为删除入口与复制步骤，不影响既有 API。

## 质量属性

- 普通功能改动，无观感目标；沿用现有页面、对话框、按钮、空状态组件。参照：`apps.tsx`、`packages.tsx`、`components/ui/dialog.tsx`。
