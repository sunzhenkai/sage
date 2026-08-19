# P0 退出评审

日期：2026-08-12  
结论：**通过，授权 P1 与 P4；P4 仍必须完成 Worker restart、Activity retry 和负向 nondeterminism 场景。**

## 验收证据

- 版本与许可：`docs/runtime-versions.md`、精确 `package.json` 和 `pnpm-lock.yaml`。
- 工程质量：`corepack pnpm check` 依次执行 lint、依赖边界、typecheck、test、build。
- Pi：`corepack pnpm spike:pi` 验证事件、取消、transcript checkpoint/resume Adapter 路径。
- Temporal：`corepack pnpm spike:temporal` 验证 Workflow bundle 与配置契约；`docker compose up -d --wait` 验证本地 Namespace 服务依赖。
- Adapter：`@sage/platform-ports`、`@sage/local-fakes` 和可复用 Artifact contract suite。
- Owner/隔离：`docs/control-plane-decisions.md`。

## Gate 与风险接受

1. P1 可以继续，但必须将 Pi 的 Skill/checkpoint/resume 缺口封装在 HarnessPort 后。
2. P4 可以继续，但不得把 P0 bundle 测试表述为生产 replay/Worker Versioning 完成。
3. Pi 包已出现上游迁移 deprecation，当前精确版本继续用于 MVP；升级或包名迁移触发新 Spike。
4. MinIO AGPL 镜像仅用于本地 profile，生产通过 Artifact Port 接入批准的 S3-compatible 服务。
