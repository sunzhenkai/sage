## 1. 设计令牌与全局基础

- [ ] 1.1 `styles.css`：重写 `:root` 令牌组（paper 画布/surface 案面/ink/muted/faint/line/pine/pine-deep/pine-soft/sealred/sealred-soft/amber/amber-soft/indigo/indigo-soft/primary 墨色主操作/shell 壳层系列、三段字体栈），逐角色核对对比度下限
- [ ] 1.2 保留质量底线字面断言内容：`.task-row .status-badge { display: inline-flex; }` 存在、`:focus-visible` 焦点环、`prefers-reduced-motion: reduce` 回退、页面级 `overflow-x: hidden`

## 2. WorkspaceShell

- [ ] 2.1 画布浅色侧栏主题（墨印 brand、工作区切换器白卡、导航药丸 hover/active 态、runtime 白卡、账户区、语言控件），折叠态（66px 图标列）与 ≤980px/≤700px 断点行为保持；根元素 className 保持 `'sidebar'` / `'sidebar is-collapsed'` 二值
- [ ] 2.2 案面结构：`.main-column` 白底 + 发丝边 + 左上圆角 + 画布露边，≤700px 退化为平面拼接

## 3. Chat 视图

- [ ] 3.1 用户/助手气泡双侧形态、思考块、活动行、待答圆点（对话区不设脊线与序号刻度）
- [ ] 3.2 Composer、快捷提示、错误/成功横幅、只读 notice、事件流调试面板与 JSONL 复制行
- [ ] 3.3 对话 landing（历史列表、归档切换、两步删除确认态）、recovery 页、boot-error 页

## 4. Tasks / Packages / Providers 视图

- [ ] 4.1 任务列表表格行、状态徽章语义映射、投影新鲜度组件（390px 三要素可见）
- [ ] 4.2 任务详情双卡布局、控制按钮网格、时间线菱形刻度、产物列表；应用包列表/详情/资产预览/Release 历史
- [ ] 4.3 Providers 页（运行 Agent 设置卡、provider 卡片栈）、添加/编辑弹窗与 catalog combobox 下拉

## 5. TSX 加法改动与首帧骨架

- [ ] 5.1 `main.tsx` brand-mark 字形改为「思」
- [ ] 5.2 `index.html`：theme-color/favicon/骨架的配色与几何替换为新主题值（骨架 main 同步案面边框/圆角/露边），消除挂载前后闪变

## 6. 验证收尾

- [ ] 6.1 类名清单核对：196 个既有类钩子在重构后逐一确认有规则或显式废弃记录，无遗漏选择器
- [ ] 6.2 运行 agent-web vitest 全量、typecheck、vite build；390×844 与 ≤700px 手工检查
- [ ] 6.3 `openspec validate web-ui-design-language --strict` 通过
