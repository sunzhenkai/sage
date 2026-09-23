## 1. P1#6~#7

- [x] 1.1 默认模型列表可用状态改 i18n 词条，与 `common.notAvailable` 对称（ProvidersView.tsx:392 一带）
- [x] 1.2 `packages.title` 改「应用」/ `Apps`，rail 与 topbar 核验生效

## 2. P1#8~#9

- [x] 2.1 `en.ts` 中 conversation / chat / thread 词条改 Session / Sessions，按钮用 `New session`（报告列出的全部行）
- [x] 2.2 「默认模型」各句改「默认运行模型」/ `default run model`（zh-CN.ts:233~249 一带及 en.ts 对应句）

## 3. P1#10~#11

- [x] 3.1 「重试此 Run」改「重试此 Chat Run」；启动成功文案与「打开 Task」对齐（ChatView / PackagesView 文案点）
- [x] 3.2 「声明的 Task」与启动表单标签改 Declared Task；`entry` 列头改 i18n 词条

## 4. 收尾

- [x] 4.1 grep 复核避免词无残留；`pnpm lint`（agent-web 范围）通过；手工冒烟无 console error
