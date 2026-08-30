# 验证记录：AI App 输出定义修正与压缩包上传

日期：2026-08-30

## 覆盖范围

- 输出目录打包器：回写、缺文件、多文件+二进制、空目录、符号链接拒绝。
- 源包解包器：穿越、符号链接、超限、损坏 gzip、纯文本 gzip、双层 gzip。
- Worker slice：`SAGE_OUTPUT_DIR` 注入后打包上传；`PROVIDER_DEPENDENCY_MISSING` 与 `PACKAGE_OUTPUT_MISSING_FILE` 终态 `failed`，不走 `effect_unknown`。
- Artifact 取回：package 行 `application/gzip` + `#file/` 文本 utf-8 / 二进制 base64。
- 上传 API：JSON 通道与 tar.gz multipart 的 `contentDigest` 逐字节等价；tar/zip 可登记；`APP_PACKAGE_ID_MISMATCH` 仍为 409。
- Web：成功态 package 下载 + 文件清单；失败态错误码/明细且 Retry 可用；上传改为文件选择器并刷新版本历史。
- 示例 App：finance-briefing / github-trending 提示词不再要求按 `output.schema.json` 输出 JSON；`output.files` 保留。

## 本地栈端到端

finance-briefing 的真实模型跑通依赖本地 Temporal + provider 凭据。本 change 用 worker 集成测试复现同一物化路径（目录 → `output.tar.gz` → `#file/brief.md` 可取回；确定性失败可重试）。归档前若本地栈可用，再补一次真实 run。

## 归档说明

主 spec（`openspec/specs/package-output-contract`、`package-management-interface`）由本 change delta 在 archive 步骤生成，不在 apply 阶段手改。
