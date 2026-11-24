# Design: SSH Readonly Inspect Capability

## 架构边界
- `packages/tool-runtime` 遵守 `package-ownership.json`，不直接依赖 `@sage/task-domain` 或 `@sage/secret-vault`，通过 `SshInspectTargetProvider` 接口在 `agent-worker` 执行边界桥接 `PostgresTaskStore` 与 `SecretBackend`。
- 模型只能调用 `ssh_list_targets`（不返回 host/IP/username/命令原文）和 `ssh_readonly_inspect({ hostAlias, check })`，无法执行任意 shell 命令。
- 默认 `defaultSshCommandRunner` 使用 `execFile('ssh', ...)`（非 shell），严格校验 `host` 不以 `-` 开头防参数注入，密钥落临时 0600 文件并在 `finally` 覆写清零删除。
