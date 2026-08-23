## 1. 背景内联

- [x] 1.1 `index.html` 的 `<html>` 内联 `style="background:#f4f6fb"`，CSS 加载前首帧即灰底（保留 `styles.css` 既有 `:root`/`html` 背景规则）

## 2. 首帧骨架屏

- [x] 2.1 `index.html` 的 `#root` 内预置静态骨架节点（左侧深色边栏块 + 主区浅灰底占位条），与真实布局同色（边栏 `#101828`、主区 `#f4f6fb`、占位条 `#e4e9f2`）
- [x] 2.2 骨架样式内联 `<style>`（类名 `.boot-skeleton`），首帧即生效；依赖 React `createRoot().render()` 替换 `#root` 内容自动移除骨架，无清理代码

## 3. 验证

- [x] 3.1 `pnpm --filter @sage/agent-web build` 通过，产物 `dist/index.html` 含内联背景与骨架
- [x] 3.2 浏览器实测刷新：首帧灰底无白屏、骨架存在、挂载后无缝过渡无残留
- [x] 3.3 `openspec validate --strict --type change flash-fix-firstpaint` 通过
