import { describe, expect, it, vi } from 'vitest';
import { ProductionSandboxToolExecutor, assertProductionSandboxProfile, productionSandboxProfile } from './sandbox.js';

describe('production sandbox profile', () => {
  it('creates a non-root bounded profile', () => expect(() => assertProductionSandboxProfile(productionSandboxProfile({ network: 'egress-proxy-only', timeoutMs: 1000, outputBytes: 1024 }))).not.toThrow());
  it('rejects privilege and exhaustion profiles', () => { const safe = productionSandboxProfile({ network: 'none', timeoutMs: 1000, outputBytes: 1024 }); expect(() => assertProductionSandboxProfile({ ...safe, runAsUser: 0 })).toThrow('SANDBOX_PRIVILEGE_INVALID'); expect(() => assertProductionSandboxProfile({ ...safe, capabilities: ['SYS_ADMIN'] })).toThrow('SANDBOX_CAPABILITY_INVALID'); expect(() => assertProductionSandboxProfile({ ...safe, limits: { ...safe.limits, pids: 100000 } })).toThrow('SANDBOX_LIMIT_INVALID'); });
  it('requires healthy sandbox and egress, denies network bypass, and enforces output limits', async () => {
    const execute = vi.fn(async () => ({ exitCode: 0, stdout: new TextEncoder().encode('{"ok":true}'), stderr: new Uint8Array(), timedOut: false }));
    const egressRequest = vi.fn(async () => ({ status: 200, headers: {}, body: new Uint8Array() }));
    const subject = new ProductionSandboxToolExecutor({ execute, health: async () => ({ healthy: true, checkedAt: new Date().toISOString() }) }, { request: egressRequest, health: async () => ({ healthy: true, checkedAt: new Date().toISOString() }) });
    const signal = new AbortController().signal;
    await expect(subject.execute({ executableRef: 'oci://trusted', input: {}, egressUrls: ['https://api.example/v1'], profile: productionSandboxProfile({ network: 'none', timeoutMs: 1000, outputBytes: 1024 }), signal })).rejects.toThrow('EGRESS_DENIED');
    expect(execute).not.toHaveBeenCalled();
    await expect(subject.execute({ executableRef: 'oci://trusted', input: {}, egressUrls: [], profile: productionSandboxProfile({ network: 'egress-proxy-only', timeoutMs: 1000, outputBytes: 1024 }), signal })).resolves.toEqual({ ok: true });
    execute.mockResolvedValueOnce({ exitCode: 0, stdout: new Uint8Array(2048), stderr: new Uint8Array(), timedOut: false });
    await expect(subject.execute({ executableRef: 'oci://trusted', input: {}, egressUrls: [], profile: productionSandboxProfile({ network: 'egress-proxy-only', timeoutMs: 1000, outputBytes: 1024 }), signal })).rejects.toThrow('SANDBOX_OUTPUT_LIMIT_EXCEEDED');
  });
});
