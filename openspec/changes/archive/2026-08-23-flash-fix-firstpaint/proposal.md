## Why

页面闪屏的第一个来源是首帧白屏/空白：`index.html` 的 `#root` 为空、背景色 `#f4f6fb` 写在 CSS 而非 HTML，React 挂载前浏览器展示默认白底与空布局。

## What Changes

- `index.html`：`<html>`/`body` 内联背景色 `#f4f6fb`，CSS 加载前首帧即灰底，消除白屏闪烁（FOUC）
- `index.html`：`#root` 内预置与最终布局同色的静态骨架（深色侧边栏块 + 浅灰主区占位），样式内联 `<style>` 首帧生效；React 挂载时 `createRoot().render()` 自动替换 `#root` 内容，无需清理代码
- `styles.css`：骨架样式限定在 `#root:empty` 作用域，挂载后即消失，避免与真实布局残留叠加

## Capabilities

本 change 为纯实现优化（首帧渲染时序），无 spec 增量。`.openspec.yaml` 已设 `skip_specs: true`。

## Impact

- `platform/apps/agent-web/index.html`：内联背景色 + `#root` 骨架屏 + `<style>`
- `platform/apps/agent-web/src/styles.css`：`#root:empty` 骨架样式
- 无运行时代码/行为变化（挂载后与现状一致）
