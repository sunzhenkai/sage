## 1. 列表行布局（P1#1）

- [x] 1.1 `.pkg-row` 改为纵向行布局，去掉 `.pkg-row-meta` 的 `white-space: nowrap`，时间改用短格式（对照 ui-check.md P1#1）
- [x] 1.2 `.pkg-example-grid` 改 `minmax(0, 1fr)`；320px / 220px 宽度手工核验无溢出、隐藏滚动条下无内容被裁

## 2. 表头 i18n（P2#16）

- [x] 2.1 inputs / data sources / releases 三张表 `<th>` 改走 i18n 词条（PackagesView.tsx 相关行）
- [x] 2.2 `zh-CN.ts` 中 Manifest / Assets / Releases 标题补译，`en.ts` 对齐；中文界面手工核验无英文残留

## 3. 收尾

- [x] 3.1 `pnpm lint`（agent-web 范围）通过；UI 手工冒烟无 console error
