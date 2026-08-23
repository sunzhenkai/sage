## Context

当前 `#root` 在 `index.html` 中为空，背景色在 CSS（`styles.css`）而非 HTML。React 挂载前浏览器显示默认白底 + 空 `#root`，是首帧白屏/空白的直接来源。`createRoot().render()` 会用渲染内容替换 `#root` 子节点，这是 React 标准行为，可在 `#root` 里安全预置静态骨架。

## Goals / Non-Goals

**Goals:**
- 首帧即灰底（背景内联），消除白屏闪烁
- 首帧 `#root` 有与真实布局同色的静态骨架，消除空白闪
- 骨架仅在 React 挂载前可见，挂载后无残留

**Non-Goals:**
- 不引入 SSR/预渲染
- 不做真实数据预填（数据加载仍由各 App 异步完成）
- 不改变挂载后渲染行为

## Decisions

### D1 背景色内联到 `<html>` 而非 `body`
`styles.css:3` 的 `:root` 已有 `background:#f4f6fb`。`html { background:#f4f6fb }` 也在（styles.css:9）。在 `index.html` 的 `<html style="background:#f4f6fb">` 内联，CSS 加载前首帧即灰。`body` 默认透明会透出 `html` 背景，无需再给 body 设色。保留 CSS 规则以保证挂载后一致。

### D2 `#root` 预置骨架 + `#root:empty` 作用域样式
`index.html` 的 `#root` 内放静态骨架节点：
- 左侧深色边栏块（`#101828` 同色）+ 品牌区占位
- 主区浅灰底（`#f4f6fb`）+ 内容占位条
样式内联 `<style>` 限定 `#root:empty` 之外的元素不显示副作用——更稳的做法：骨架样式写成 `#root > .boot-skeleton`，且挂载后 React 清空 `#root` 子节点，骨架自然消失。为绝对保险，可在 `main.tsx` 渲染前不移除（React 自动替换），并让骨架类只在 `#root:not(:has(.app-frame))` 或直接依赖 React 替换行为。选择：骨架用独立类 `.boot-skeleton`，样式内联；`createRoot().render()` 替换 `#root` 内容后骨架 DOM 被移除，无需额外 JS。

### D3 骨架与真实布局同色同构
侧边栏用 `#101828`（与 `.sidebar` 一致）、品牌块用渐变近似、主区 `#f4f6fb` + 几条 `#e4e9f2` 圆角占位条。视觉上首帧≈最终布局的"空态"，挂载后无缝过渡。

## Risks / Trade-offs

- 骨架屏若与真实布局色差明显会造成"又闪一下"；用同色系（D3）规避。
- `#root:empty` 伪类在 React 未挂载时匹配，但挂载瞬间 `#root` 非空；为兼容，骨架样式不依赖 `#root:empty`，而是依赖 React 替换行为（骨架 DOM 直接被移除），更简单可靠。
