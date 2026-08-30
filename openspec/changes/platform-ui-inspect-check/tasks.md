## 1. 取证准备
- [x] 1.1 确认 dev 服务可用：agent-web `http://127.0.0.1:9612` HTTP 200 且 `/v1/tasks` 代理通；不可用时按 `.service-manager.md` 模板重启（infra 容器不动）
- [x] 1.2 用 Playwright MCP 打开 agent-web，确认五个视图（chat / tasks / packages / schedules / providers）可达

## 2. 截图取证
- [x] 2.1 桌面宽度逐视图截图，存 `openspec/changes/platform-ui-inspect-check/evidence/`（命名 `<view>-desktop.png`）
- [x] 2.2 同屏可到的交互态（empty / error / 展开 / 弹窗）补截图
- [x] 2.3 窄屏（375–390px）对布局敏感的视图补截图（`<view>-mobile.png`）

## 3. 对照清单检查
- [x] 3.1 按 ui-inspect 清单逐视图过：整体布局 / 内容块 padding / 元素间隔 / 分割线 / 图标与按钮 / 对齐 / 呼吸、降噪、微交互 / 交互克制；间距跟项目既有刻度（`styles.css` 既有变量与既有节奏），不发明新刻度
- [x] 3.2 发现按 P0（重叠/溢出/遮挡）/ P1（节奏不一致、多余交互层）/ P2（光学微调）分级

## 4. 产出报告
- [x] 4.1 写 `openspec/changes/platform-ui-inspect-check/report.md`，按 ui-inspect 输出格式逐视图给出 findings 与建议对齐规则
- [x] 4.2 对话里按 P0→Pn 呈报总结，交用户确认重构范围
