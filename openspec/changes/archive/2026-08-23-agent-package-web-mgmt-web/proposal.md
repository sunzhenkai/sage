## Why
后端已有 App 主体管理与上传端点（子 change 1、2），但 agent-web 的 Packages 域只有浏览/发起运行，用户无法在页面完成应用包管理：新建 App、上传/更新版本、删除 App。

本 change 是 taskflow driver `agent-package-web-mgmt-driver` 的子 change（切片 3/3），负责 agent-web 的应用包管理界面。

## What Changes
- agent-web Packages 域升级为「应用包管理」，数据源切到 apps 端点：
  - 列表页：新增「新建 App」入口（appId/name/description 表单）；空态引导新建
  - 详情页：新增「上传/更新版本」表单（上传源包文件 → 新版本）、「删除 App」按钮（二次确认 + 结果反馈）；保留 manifest/资产/release 历史/发起运行
  - 版本历史倒序展示，上传后自动刷新
- 新增中英文案与 aria 语义；沿用既有 React + fetch + styles.css 风格
- 单测覆盖：列表渲染、新建表单校验、上传、删除确认、版本历史、错误态

## Capabilities

### Modified Capabilities
- `package-management-interface` — 新增「应用包管理」requirement（ADDED）

## Non-goals
- 不做后端实现（属子 change 1、2）
- 不做包内容在线编辑
- 不改发起运行与资产预览的既有行为
- 不引入新 UI/表单依赖

## 涉及面
| 仓库 | 角色 | 说明 |
|------|------|------|
| . | 必须 | 会修改 platform/apps/agent-web 与 openspec specs |

## 验收标准
- [ ] 列表页有「新建 App」入口，新建成功后可看到新 App
- [ ] 详情页可上传源包生成新版本，版本历史新增
- [ ] 详情页可删除 App（有确认），删除后列表不再显示
- [ ] 空态/加载/错误态展示正常；双语文案齐全
- [ ] `pnpm --filter @sage/agent-web` 测试、typecheck、build 通过；`openspec validate --strict` 通过

## 验证记录
