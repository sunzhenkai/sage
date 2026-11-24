# Proposal: 受控 SSH 目标托管与只读主机检查能力

## 背景
阶段 1 补齐了外网 HTTP/TLS/TCP 探测，但无法感知主机内部的 sshd 策略、监听端口、防火墙、fail2ban、异常持久化任务或容器状态。

## 目标
1. 在 `task-domain` / `task-store-postgres` / `agent-api` 新增 `ssh_targets` 与 `ssh_credentials`（复用 `secret-vault` AES-256-GCM 密封存储），提供 `/v1/ssh-targets` 管理接口（只写不读私钥）。
2. 在 `@sage/tool-runtime` 新增通用只读能力 `capability://ssh-readonly-inspect/v1`（`ssh_list_targets` 与 `ssh_readonly_inspect`），仅允许对受管目标执行 6 项通用 Linux 只读原语或运维预登记命名只读检查，绝不暴露任意 shell；执行边界临时落 0600 密钥并在 `finally` 覆写销毁，输出强制脱敏。
3. 在 `agent-worker` 按 `runContract.capabilityRefs` 独立按需注入（权限单调收窄）。
