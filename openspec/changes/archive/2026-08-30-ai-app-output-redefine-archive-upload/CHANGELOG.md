# CHANGELOG

## 2026-08-30

- Task 权威产物改为输出目录打包的 `tar.gz`；模型正文不再进入 JSON 物化闸门。
- 确定性失败（缺 provider、缺声明文件、超限）终态为 `failed`，投影带错误码与明细，UI 可重试。
- `POST /v1/apps/:appId/releases` 新增 multipart 压缩包通道；包管理页改为文件选择器。
- 验证记录见 `verification.md`。主 spec 在 archive 时由本 change delta 生成。
