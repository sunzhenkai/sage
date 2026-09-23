## Context
九项问题均为小改动：CSS 选择器/属性、ARIA 属性、文案词条与一个空态分支，无结构重构。

## Goals / Non-Goals
**Goals:**
- 键盘与读屏用户可感知导航名称、错误、combobox 高亮与按钮加载态
- 窄宽度（≤860px）下无内容撑破、无空 `<ol>` 空窗

**Non-Goals:**
- 不改视觉风格、不引入组件库

## Decisions
- P1#2 用视觉隐藏（如 `.visually-hidden`）而非 `display: none`，保留无障碍树；同时修 `.settings-page` → `.settings-view` 让 32px 图标栏规则真正生效
- P1#4 遵循 layout-v1：错误为独立 `role="alert"` 常驻，去掉外层 `aria-live="polite"`，避免双重播报
- P1#5 采用 `aria-activedescendant` 方案（焦点留在输入框），option id 需稳定唯一
- P2#14 只加 `aria-busy`，不改按钮文案，避免布局抖动

## Risks / Trade-offs
- [去掉外层 aria-live 后，部分读屏对动态插入的 status 播报时机变化] → 用读屏手工冒烟核验两类通知各播报一次
