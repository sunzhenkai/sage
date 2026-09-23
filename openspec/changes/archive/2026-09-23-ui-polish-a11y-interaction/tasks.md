## 1. 导航与列表栏（P1#2、P1#3）

- [x] 1.1 `.rail-label` 改视觉隐藏保留无障碍树；折叠按钮补 `title`；`.settings-page` 选择器改 `.settings-view`
- [x] 1.2 会话删除确认按钮改 `common.confirm`，整句说明放 `title`；220px 宽度核验不撑破

## 2. 读屏支持（P1#4、P1#5、P2#13、P2#14）

- [x] 2.1 Feedback 通知栈去外层 `aria-live`，`role="status"` / `role="alert"` 子节点各自生效，读屏冒烟各播报一次
- [x] 2.2 目录 combobox option 加稳定 id，输入框设 `aria-activedescendant`，方向键读屏可播报
- [x] 2.3 Task 搜索 input 补与 placeholder 一致的 `aria-label`；Button loading 补 `aria-busy="true"`

## 3. 窄宽度与空态（P2#12、P2#15）

- [x] 3.1 ChatView.css 与 PackagesView.css 两处标题头补 `flex-wrap: wrap`，低视口核验不横溢
- [x] 3.2 Task 运行日志成功但零事件分支补空态文案（与 `tasks.detail.timelineEmptyFresh` 同级词条）

## 4. 收尾

- [x] 4.1 `pnpm lint`（agent-web 范围）通过；UI 手工冒烟无 console error
