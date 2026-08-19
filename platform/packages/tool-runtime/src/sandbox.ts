export interface SandboxProfileV1 {
  readonly schemaVersion: '1'; readonly runAsUser: number; readonly runAsGroup: number; readonly readOnlyRootFilesystem: true;
  readonly noNewPrivileges: true; readonly capabilities: readonly string[]; readonly syscalls: readonly string[];
  readonly limits: { readonly cpuMillis: number; readonly memoryBytes: number; readonly pids: number; readonly timeoutMs: number; readonly outputBytes: number };
  readonly network: 'none' | 'egress-proxy-only';
}
export interface SandboxExecutionRequest { readonly profile: SandboxProfileV1; readonly executableRef: string; readonly input: Uint8Array; readonly signal: AbortSignal }
export interface SandboxExecutionResult { readonly exitCode: number; readonly stdout: Uint8Array; readonly stderr: Uint8Array; readonly timedOut: boolean }
export interface SandboxExecutorPort { execute(request: SandboxExecutionRequest): Promise<SandboxExecutionResult>; health(): Promise<{ readonly healthy: boolean; readonly checkedAt: string; readonly detail?: string }> }
const dangerousCapabilities = new Set(['ALL', 'SYS_ADMIN', 'SYS_PTRACE', 'NET_ADMIN', 'DAC_OVERRIDE', 'SETUID', 'SETGID']);
const dangerousSyscalls = new Set(['mount', 'umount2', 'ptrace', 'bpf', 'kexec_load', 'init_module', 'finit_module', 'delete_module', 'unshare', 'setns', 'reboot']);
export function assertProductionSandboxProfile(profile: SandboxProfileV1): void {
  if (profile.schemaVersion !== '1' || profile.runAsUser <= 0 || profile.runAsGroup <= 0 || !profile.readOnlyRootFilesystem || !profile.noNewPrivileges) throw new Error('SANDBOX_PRIVILEGE_INVALID');
  if (profile.capabilities.some((capability) => dangerousCapabilities.has(capability.toUpperCase()))) throw new Error('SANDBOX_CAPABILITY_INVALID');
  if (profile.syscalls.length === 0 || profile.syscalls.some((syscall) => dangerousSyscalls.has(syscall))) throw new Error('SANDBOX_SYSCALL_INVALID');
  const limits = profile.limits; if (limits.cpuMillis < 1 || limits.cpuMillis > 300_000 || limits.memoryBytes < 1024 * 1024 || limits.memoryBytes > 8 * 1024 ** 3 || limits.pids < 1 || limits.pids > 1024 || limits.timeoutMs < 1 || limits.timeoutMs > 300_000 || limits.outputBytes < 1 || limits.outputBytes > 64 * 1024 ** 2) throw new Error('SANDBOX_LIMIT_INVALID');
  if (!['none', 'egress-proxy-only'].includes(profile.network)) throw new Error('SANDBOX_NETWORK_INVALID');
}
export function productionSandboxProfile(input: { readonly network: SandboxProfileV1['network']; readonly timeoutMs: number; readonly outputBytes: number }): SandboxProfileV1 {
  const profile: SandboxProfileV1 = Object.freeze({ schemaVersion: '1', runAsUser: 65532, runAsGroup: 65532, readOnlyRootFilesystem: true, noNewPrivileges: true, capabilities: Object.freeze([]), syscalls: Object.freeze(['read', 'write', 'close', 'exit', 'exit_group', 'futex', 'clock_gettime', 'nanosleep', 'brk', 'mmap', 'munmap', 'mprotect']), limits: Object.freeze({ cpuMillis: Math.min(input.timeoutMs, 30_000), memoryBytes: 256 * 1024 ** 2, pids: 16, timeoutMs: input.timeoutMs, outputBytes: input.outputBytes }), network: input.network });
  assertProductionSandboxProfile(profile); return profile;
}


import type { ControlledEgressConnectorPort } from './egress.js';
export interface ProductionToolExecutionRequest {
  readonly executableRef: string;
  readonly input: unknown;
  readonly egressUrls: readonly string[];
  readonly profile: SandboxProfileV1;
  readonly signal: AbortSignal;
}
export interface ProductionToolExecutorPort {
  execute(request: ProductionToolExecutionRequest): Promise<unknown>;
  health(): Promise<{ readonly healthy: boolean; readonly checkedAt: string; readonly detail?: string }>;
}
/**
 * The only production Tool execution bridge. External connections are made by the
 * revalidating connector; provider responses become bounded sandbox input and no
 * production call reaches the in-process ToolDefinition.execute callback.
 */
export class ProductionSandboxToolExecutor implements ProductionToolExecutorPort {
  constructor(private readonly sandbox: SandboxExecutorPort, private readonly egress: ControlledEgressConnectorPort) {}
  async execute(request: ProductionToolExecutionRequest): Promise<unknown> {
    assertProductionSandboxProfile(request.profile);
    const [sandboxHealth, egressHealth] = await Promise.all([this.sandbox.health(), this.egress.health()]);
    if (!sandboxHealth.healthy) throw new Error('SANDBOX_UNAVAILABLE');
    if (!egressHealth.healthy) throw new Error('EGRESS_UNAVAILABLE');
    if (request.profile.network === 'none' && request.egressUrls.length > 0) throw new Error('EGRESS_DENIED');
    const egressResponses = [];
    for (const url of request.egressUrls) {
      const response = await this.egress.request({ url, signal: request.signal });
      egressResponses.push({ status: response.status, headers: response.headers, body: [...response.body] });
    }
    const encoded = new TextEncoder().encode(JSON.stringify({ input: request.input, egressResponses }));
    if (encoded.byteLength > request.profile.limits.outputBytes) throw new Error('SANDBOX_INPUT_LIMIT_EXCEEDED');
    const result = await this.sandbox.execute({ profile: request.profile, executableRef: request.executableRef, input: encoded, signal: request.signal });
    if (result.timedOut) throw new Error('SANDBOX_TIMEOUT');
    if (result.exitCode !== 0) throw new Error('SANDBOX_EXECUTION_FAILED');
    if (result.stdout.byteLength > request.profile.limits.outputBytes || result.stderr.byteLength > request.profile.limits.outputBytes) throw new Error('SANDBOX_OUTPUT_LIMIT_EXCEEDED');
    try { return JSON.parse(new TextDecoder().decode(result.stdout) || 'null'); } catch { throw new Error('SANDBOX_OUTPUT_INVALID'); }
  }
  async health() {
    const [sandbox, egress] = await Promise.all([this.sandbox.health(), this.egress.health()]);
    return { healthy: sandbox.healthy && egress.healthy, checkedAt: new Date().toISOString(), ...(!sandbox.healthy || !egress.healthy ? { detail: 'PRODUCTION_TOOL_EXECUTOR_UNAVAILABLE' } : {}) };
  }
}
