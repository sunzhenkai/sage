# pi-harness-adapter Delta

## REMOVED Requirements

### Requirement: 本地 echo harness 人类可读输出
**Reason**: echo 离线模式随统一 provider 模型整体移除，本地确定性 harness 不再是任何产品路径的执行选项；对话默认运行时改为工作区 provider 引用路由。
**Migration**: 依赖 echo 输出形态的对话测试改用 fake LiveProviderInvoker 的确定性回复断言；「默认运行时对话气泡显示纯文本」的体验由真实模型回复天然满足，无替代需求。
