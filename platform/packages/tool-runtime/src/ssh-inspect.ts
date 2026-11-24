import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';
import { redactProbeSnippet, type RuntimeToolBinding, type RuntimeToolExecutionResult } from './net-probe.js';

/**
 * 主机只读安全检查能力（`capability://ssh-readonly-inspect/v1`）：
 * 仅允许对平台托管的受控 SSH 目标执行内置 6 项通用 Linux 只读原语或运维预登记的命名只读检查；
 * 绝不向模型暴露任意 shell 命令，私钥仅在执行边界临时落 0600 文件并在 finally 覆写清零销毁。
 */
export const SSH_INSPECT_CAPABILITY_REF = 'capability://ssh-readonly-inspect/v1' as const;

export const BUILTIN_SSH_READONLY_CHECKS = [
  'system_health',
  'docker_status',
  'sshd_policy',
  'network_exposure',
  'persistence_and_users',
  'auth_summary',
] as const;

export type BuiltinSshReadonlyCheck = (typeof BUILTIN_SSH_READONLY_CHECKS)[number];

const BUILTIN_CHECK_SCRIPTS: Readonly<Record<BuiltinSshReadonlyCheck, string>> = {
  system_health: [
    'echo "os=$(grep -m1 ^PRETTY_NAME= /etc/os-release 2>/dev/null | cut -d= -f2- | tr -d \'"\' || uname -s)"',
    'echo "kernel=$(uname -r)"',
    'echo "uptime=$(uptime -p 2>/dev/null || uptime)"',
    'echo "cpu_cores=$(nproc 2>/dev/null || echo unknown)"',
    'echo "loadavg=$(cut -d" " -f1-3 /proc/loadavg 2>/dev/null || echo unknown)"',
    'awk \'/MemTotal:/{t=$2} /MemAvailable:/{a=$2} END{printf "mem_total_kb=%s\nmem_avail_kb=%s\n", t+0, a+0}\' /proc/meminfo 2>/dev/null',
    'echo "--- disk_usage ---"',
    'df -P -x tmpfs -x devtmpfs -x overlay 2>/dev/null | head -n 30',
    'echo "failed_units=$(systemctl --failed --no-legend 2>/dev/null | wc -l || echo 0)"',
    'echo "dmesg_errors=$(dmesg 2>/dev/null | grep -iEc "I/O error|MCE|EDAC|NVMe.*error|EXT4-fs error|XFS.*corrupt|Out of memory" || echo 0)"',
  ].join('\n'),
  docker_status: [
    'if ! command -v docker >/dev/null 2>&1; then echo "docker=unavailable"; else',
    '  echo "docker=available"',
    '  docker ps -a --format "{{.Names}}\t{{.State}}\t{{.Status}}" 2>/dev/null | head -n 80',
    'fi',
  ].join('\n'),
  sshd_policy: [
    'sshT="$(sshd -T 2>/dev/null)"; [ -z "$sshT" ] && sshT="$(sudo -n sshd -T 2>/dev/null)"',
    'if [ -z "$sshT" ]; then echo "readable=0"; else',
    '  echo "readable=1"',
    '  printf "%s\\n" "$sshT" | grep -E "^(port|passwordauthentication|permitrootlogin|pubkeyauthentication|kbdinteractiveauthentication) "',
    'fi',
  ].join('\n'),
  network_exposure: [
    'echo "--- listen ---"',
    'ss -H -lntu 2>/dev/null | awk \'{print $1, $5}\' | sort -u | head -n 80',
    'echo "--- ufw ---"',
    'ufwOut="$(sudo -n ufw status 2>/dev/null || ufw status 2>/dev/null)"',
    'printf "%s\\n" "$ufwOut" | head -n 1',
    'echo "--- fail2ban ---"',
    'if command -v systemctl >/dev/null 2>&1; then systemctl is-active fail2ban 2>/dev/null || echo "inactive"; else echo "unknown"; fi',
  ].join('\n'),
  persistence_and_users: [
    'echo "--- users_ge_1000 ---"',
    'awk -F: \'$3>=1000 && $3<65534 {print $1 ":" $3 ":" $7}\' /etc/passwd',
    'cron_lines=$(awk -F: \'$3>=1000 && $3<65534 {print $1}\' /etc/passwd | while read -r u; do crontab -u "$u" -l 2>/dev/null; done | grep -vcE "^[[:space:]]*(#|$)" || true)',
    'echo "user_crontab_lines=${cron_lines:-0}"',
    'tmp_exec_count=$(find /tmp /dev/shm -xdev -type f -perm /111 2>/dev/null | wc -l)',
    'echo "tmp_exec_count=${tmp_exec_count:-0}"',
    'find /tmp /dev/shm -xdev -type f -perm /111 2>/dev/null | head -n 20',
  ].join('\n'),
  auth_summary: [
    'if command -v lastb >/dev/null 2>&1; then echo "lastb_count=$(lastb 2>/dev/null | grep -vc "^$" || echo 0)"; else echo "lastb=unavailable"; fi',
    'echo "--- recent_logins ---"',
    'last -n 15 2>/dev/null | head -n 15 || echo "last=unavailable"',
  ].join('\n'),
};

export interface SshInspectTargetDescriptor {
  readonly alias: string;
  readonly host: string;
  readonly port: number;
  readonly username: string;
  readonly knownHostEntry?: string;
  readonly customChecks: Readonly<Record<string, string>>;
  readonly enabled: boolean;
  readonly credentialPresent: boolean;
}

export interface SshInspectTargetProvider {
  listTargets(): Promise<readonly SshInspectTargetDescriptor[]>;
  getTarget(alias: string): Promise<SshInspectTargetDescriptor | undefined>;
  openPrivateKey(alias: string): Promise<string | undefined>;
}

export interface SshCommandExecResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export type SshCommandRunner = (input: {
  readonly target: SshInspectTargetDescriptor;
  readonly privateKey: string;
  readonly script: string;
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
}) => Promise<SshCommandExecResult>;

export interface CreateSshInspectToolsOptions {
  readonly targetProvider: SshInspectTargetProvider;
  readonly commandRunner?: SshCommandRunner;
  readonly now?: () => number;
}

const DEFAULT_SSH_TIMEOUT_MS = 15_000;
const MAX_STDOUT_CHARS = 16_384;
const MAX_STDERR_CHARS = 2_048;
const SAFE_USERNAME_PATTERN = /^[a-zA-Z0-9._-]{1,64}$/;

const truncate = (value: string, maxChars: number): string =>
  value.length <= maxChars ? value : `${value.slice(0, maxChars)}\n...[truncated]`;

const isSafeHost = (host: string): boolean =>
  host.length > 0 && host.length <= 255 && !host.startsWith('-') && !/\s/.test(host);

export const defaultSshCommandRunner: SshCommandRunner = async ({ target, privateKey, script, timeoutMs, signal }) => {
  if (!isSafeHost(target.host) || !SAFE_USERNAME_PATTERN.test(target.username)) {
    throw new Error('SSH_TARGET_UNSAFE');
  }
  const workDir = await mkdtemp(join(tmpdir(), 'sage-ssh-'));
  const keyPath = join(workDir, 'id');
  const normalizedKey = privateKey.endsWith('\n') ? privateKey : `${privateKey}\n`;
  try {
    await writeFile(keyPath, normalizedKey, { mode: 0o600 });
    const hostKeyArgs: string[] = [];
    if (target.knownHostEntry !== undefined && target.knownHostEntry.trim().length > 0) {
      const knownHostsPath = join(workDir, 'known_hosts');
      await writeFile(knownHostsPath, `${target.knownHostEntry.trim()}\n`, { mode: 0o600 });
      hostKeyArgs.push('-o', 'StrictHostKeyChecking=yes', '-o', `UserKnownHostsFile=${knownHostsPath}`);
    } else {
      hostKeyArgs.push('-o', 'StrictHostKeyChecking=accept-new', '-o', 'UserKnownHostsFile=/dev/null');
    }

    const args = [
      '-o', 'BatchMode=yes',
      '-o', 'ConnectTimeout=8',
      '-o', 'IdentitiesOnly=yes',
      '-o', 'ServerAliveInterval=5',
      '-o', 'ServerAliveCountMax=2',
      ...hostKeyArgs,
      '-i', keyPath,
      '-p', String(target.port),
      `${target.username}@${target.host}`,
      'bash -s',
    ];

    return await new Promise<SshCommandExecResult>((resolve, reject) => {
      const child = execFile(
        'ssh',
        args,
        { timeout: timeoutMs, maxBuffer: 256 * 1024, signal, encoding: 'utf8' },
        (error, stdout, stderr) => {
          if (error === null) {
            resolve({ stdout: stdout ?? '', stderr: stderr ?? '', exitCode: 0 });
            return;
          }
          const code = (error as { readonly code?: unknown }).code;
          if (typeof code === 'number') {
            resolve({ stdout: stdout ?? '', stderr: stderr ?? '', exitCode: code });
            return;
          }
          reject(error);
        }
      );
      child.stdin?.write(script);
      child.stdin?.end();
    });
  } finally {
    // 覆写清零临时私钥并销毁目录，避免宿主机/容器残留。
    await writeFile(keyPath, Buffer.alloc(Buffer.byteLength(normalizedKey, 'utf8'), 0), { mode: 0o600 }).catch(() => undefined);
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
};

const ListTargetsInputSchema = Type.Object({}, { additionalProperties: false });

const InspectInputSchema = Type.Object(
  {
    hostAlias: Type.String({ minLength: 1, maxLength: 64 }),
    check: Type.String({ minLength: 1, maxLength: 64 }),
    timeoutMs: Type.Optional(Type.Integer({ minimum: 1_000, maximum: 30_000 })),
  },
  { additionalProperties: false }
);
type InspectInput = Static<typeof InspectInputSchema>;

const toolError = (errorCode: string, message: string): RuntimeToolExecutionResult => ({
  content: JSON.stringify({ ok: false, errorCode, message }),
  isError: true,
});

export function createSshInspectCapabilityTools(options: CreateSshInspectToolsOptions): readonly RuntimeToolBinding[] {
  const runner = options.commandRunner ?? defaultSshCommandRunner;
  const now = options.now ?? (() => Date.now());

  const listTargetsTool: RuntimeToolBinding = {
    capabilityRef: SSH_INSPECT_CAPABILITY_REF,
    name: 'ssh_list_targets',
    description: 'Lists managed SSH inspection targets (alias and available custom check names only) plus built-in read-only check names.',
    parameters: ListTargetsInputSchema,
    async execute(rawInput) {
      if (!Value.Check(ListTargetsInputSchema, rawInput)) {
        return toolError('SSH_INPUT_INVALID', 'Invalid ssh_list_targets arguments');
      }
      const all = await options.targetProvider.listTargets();
      const targets = all
        .filter((t) => t.enabled && t.credentialPresent)
        .map((t) => ({
          alias: t.alias,
          customChecks: Object.keys(t.customChecks).sort(),
        }));
      return {
        content: JSON.stringify({
          ok: true,
          builtinChecks: [...BUILTIN_SSH_READONLY_CHECKS],
          targets,
        }),
      };
    },
  };

  const inspectTool: RuntimeToolBinding = {
    capabilityRef: SSH_INSPECT_CAPABILITY_REF,
    name: 'ssh_readonly_inspect',
    description: 'Executes a pre-defined read-only inspection check on an enabled, credentialed SSH target alias. Arbitrary shell commands are forbidden.',
    parameters: InspectInputSchema,
    async execute(rawInput, signal) {
      if (!Value.Check(InspectInputSchema, rawInput)) {
        return toolError('SSH_INPUT_INVALID', 'Invalid ssh_readonly_inspect arguments');
      }
      const input = rawInput as InspectInput;
      const target = await options.targetProvider.getTarget(input.hostAlias);
      if (target === undefined || !target.enabled || !target.credentialPresent) {
        return toolError('SSH_TARGET_NOT_ALLOWED', `SSH target '${input.hostAlias}' is not registered, disabled, or lacks a credential`);
      }

      const builtinScript = (BUILTIN_SSH_READONLY_CHECKS as readonly string[]).includes(input.check)
        ? BUILTIN_CHECK_SCRIPTS[input.check as BuiltinSshReadonlyCheck]
        : undefined;
      const customScript = Object.prototype.hasOwnProperty.call(target.customChecks, input.check)
        ? target.customChecks[input.check]
        : undefined;
      const script = builtinScript ?? customScript;
      if (script === undefined) {
        return toolError('SSH_CHECK_NOT_ALLOWED', `Check '${input.check}' is not a built-in or registered read-only check`);
      }

      const privateKey = await options.targetProvider.openPrivateKey(target.alias);
      if (privateKey === undefined || privateKey.trim().length === 0) {
        return toolError('SSH_CREDENTIAL_UNAVAILABLE', `Credential for '${target.alias}' could not be opened`);
      }

      const timeoutMs = input.timeoutMs ?? DEFAULT_SSH_TIMEOUT_MS;
      const startedAt = now();
      try {
        const result = await runner({ target, privateKey, script, timeoutMs, signal });
        const stdout = redactProbeSnippet(truncate(result.stdout, MAX_STDOUT_CHARS));
        const stderr = redactProbeSnippet(truncate(result.stderr, MAX_STDERR_CHARS));
        if (result.exitCode === 255) {
          return {
            content: JSON.stringify({
              ok: false,
              errorCode: 'SSH_CONNECTION_FAILED',
              hostAlias: target.alias,
              check: input.check,
              exitCode: result.exitCode,
              latencyMs: Math.max(0, now() - startedAt),
              stderr,
            }),
            isError: true,
          };
        }
        return {
          content: JSON.stringify({
            ok: true,
            hostAlias: target.alias,
            check: input.check,
            exitCode: result.exitCode,
            latencyMs: Math.max(0, now() - startedAt),
            stdout,
            ...(stderr.length === 0 ? {} : { stderr }),
          }),
        };
      } catch (cause) {
        const msg = cause instanceof Error ? cause.message : 'SSH inspection failed';
        const code = cause instanceof Error && (cause.name === 'AbortError' || cause.name === 'TimeoutError')
          ? 'SSH_TIMEOUT'
          : 'SSH_EXECUTION_FAILED';
        return toolError(code, redactProbeSnippet(msg));
      }
    },
  };

  return [listTargetsTool, inspectTool];
}
