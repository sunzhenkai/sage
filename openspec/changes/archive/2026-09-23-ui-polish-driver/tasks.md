## 1. 子 change：ui-polish-packages-list（P1#1 + P2#16）

- [x] 1.1 创建子 change `ui-polish-packages-list`（skip_specs），artifacts 齐备
- [x] 1.2 实施并通过 `openspec validate --strict --type change ui-polish-packages-list` 与全部 tasks 验收

## 2. 子 change：ui-polish-terminology（P1#6~#11）

- [x] 2.1 创建子 change `ui-polish-terminology`（skip_specs），artifacts 齐备
- [x] 2.2 实施并通过 `openspec validate --strict --type change ui-polish-terminology` 与全部 tasks 验收

## 3. 子 change：ui-polish-a11y-interaction（P1#2~#5 + P2#12~#15）

- [x] 3.1 创建子 change `ui-polish-a11y-interaction`（skip_specs），artifacts 齐备
- [x] 3.2 实施并通过 `openspec validate --strict --type change ui-polish-a11y-interaction` 与全部 tasks 验收

## 4. 收口

- [x] 4.1 三个子 change 的 tasks.md 全部勾完，对照 ui-check.md 逐条（P1×11 + P2×5）核验
- [x] 4.2 `pnpm lint`（agent-web 范围）通过；UI 手工冒烟无 console error

### 验证记录（收口 2026-09-23）
- 4.1：三个子 change tasks 5/7/8 全勾，无未勾项；ui-check.md P1×11 + P2×5 全部归属并实施（P2#12 按拆分决策归 a11y 片）。编排者独立冒烟复核：中文导航显示 应用/会话/Task 工作区；Packages 列表行 clientWidth==scrollWidth（289/289，无溢出）；示例网格单列收缩；console error 0。
- 4.2：agent-web 无 lint 脚本，按仓库既有命令口径执行 `corepack pnpm -C platform/apps/agent-web typecheck`（tsc -b）exit 0；UI 手工冒烟无 console error（编排者 Playwright 复核 + 受派方浏览器核验一致）。
