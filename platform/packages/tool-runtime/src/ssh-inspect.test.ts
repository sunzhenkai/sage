import { describe, expect, it } from 'vitest';
import {
  BUILTIN_SSH_READONLY_CHECKS,
  createSshInspectCapabilityTools,
  type SshInspectTargetDescriptor,
  type SshInspectTargetProvider,
} from './ssh-inspect.js';

const targets: readonly SshInspectTargetDescriptor[] = [
  {
    alias: 'host-a',
    host: '203.0.113.10',
    port: 22,
    username: 'readonly',
    customChecks: { app_summary: 'echo "app=ok"' },
    enabled: true,
    credentialPresent: true,
  },
  {
    alias: 'host-disabled',
    host: '203.0.113.11',
    port: 22,
    username: 'readonly',
    customChecks: {},
    enabled: false,
    credentialPresent: true,
  },
  {
    alias: 'host-nokey',
    host: '203.0.113.12',
    port: 22,
    username: 'readonly',
    customChecks: {},
    enabled: true,
    credentialPresent: false,
  },
];

const provider: SshInspectTargetProvider = {
  async listTargets() { return targets; },
  async getTarget(alias) { return targets.find((t) => t.alias === alias); },
  async openPrivateKey(alias) {
    return alias === 'host-a' ? '-----BEGIN OPENSSH PRIVATE KEY-----\nZmFrZQ==\n-----END OPENSSH PRIVATE KEY-----\n' : undefined;
  },
};

describe('ssh-readonly-inspect capability', () => {
  const signal = new AbortController().signal;

  it('lists only enabled and credentialed targets without leaking host/IP/username', async () => {
    const tools = createSshInspectCapabilityTools({ targetProvider: provider });
    const listTool = tools.find((t) => t.name === 'ssh_list_targets')!;
    const res = await listTool.execute({}, signal);
    expect(res.isError).toBeUndefined();
    const parsed = JSON.parse(res.content);
    expect(parsed.builtinChecks).toEqual([...BUILTIN_SSH_READONLY_CHECKS]);
    expect(parsed.targets).toEqual([{ alias: 'host-a', customChecks: ['app_summary'] }]);
    expect(res.content).not.toContain('203.0.113.10');
    expect(res.content).not.toContain('readonly');
  });

  it('rejects unknown/disabled targets and non-allowlisted check names (forbids arbitrary shell)', async () => {
    const tools = createSshInspectCapabilityTools({ targetProvider: provider });
    const inspectTool = tools.find((t) => t.name === 'ssh_readonly_inspect')!;

    const disabled = await inspectTool.execute({ hostAlias: 'host-disabled', check: 'system_health' }, signal);
    expect(disabled.isError).toBe(true);
    expect(JSON.parse(disabled.content).errorCode).toBe('SSH_TARGET_NOT_ALLOWED');

    const noKey = await inspectTool.execute({ hostAlias: 'host-nokey', check: 'system_health' }, signal);
    expect(noKey.isError).toBe(true);
    expect(JSON.parse(noKey.content).errorCode).toBe('SSH_TARGET_NOT_ALLOWED');

    const arbitrary = await inspectTool.execute({ hostAlias: 'host-a', check: 'rm -rf /' }, signal);
    expect(arbitrary.isError).toBe(true);
    expect(JSON.parse(arbitrary.content).errorCode).toBe('SSH_CHECK_NOT_ALLOWED');
  });

  it('runs built-in and custom checks, redacts secrets, and handles SSH connection failures', async () => {
    const seenScripts: string[] = [];
    const tools = createSshInspectCapabilityTools({
      targetProvider: provider,
      now: () => 5_000,
      commandRunner: async ({ script }) => {
        seenScripts.push(script);
        if (script.includes('app=ok')) {
          return { stdout: 'app=ok token=sk-1234567890abcdefghij', stderr: '', exitCode: 0 };
        }
        return { stdout: 'os=Ubuntu\nkernel=6.8', stderr: '', exitCode: 0 };
      },
    });
    const inspectTool = tools.find((t) => t.name === 'ssh_readonly_inspect')!;

    const sysRes = await inspectTool.execute({ hostAlias: 'host-a', check: 'system_health' }, signal);
    expect(sysRes.isError).toBeUndefined();
    expect(JSON.parse(sysRes.content)).toMatchObject({ ok: true, hostAlias: 'host-a', check: 'system_health', exitCode: 0 });

    const customRes = await inspectTool.execute({ hostAlias: 'host-a', check: 'app_summary' }, signal);
    expect(customRes.isError).toBeUndefined();
    const customParsed = JSON.parse(customRes.content);
    expect(customParsed.stdout).toContain('[REDACTED]');
    expect(customParsed.stdout).not.toContain('sk-1234567890abcdefghij');
    expect(seenScripts).toHaveLength(2);

    const failTools = createSshInspectCapabilityTools({
      targetProvider: provider,
      commandRunner: async () => ({ stdout: '', stderr: 'Connection timed out', exitCode: 255 }),
    });
    const connFail = await failTools.find((t) => t.name === 'ssh_readonly_inspect')!.execute({ hostAlias: 'host-a', check: 'sshd_policy' }, signal);
    expect(connFail.isError).toBe(true);
    expect(JSON.parse(connFail.content).errorCode).toBe('SSH_CONNECTION_FAILED');
  });
});
