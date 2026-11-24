import { describe, expect, it } from 'vitest';
import {
  createLivePackageAgentClient,
  type LiveProviderToolExecutor,
  type LiveProviderToolSpec
} from '@sage/local-runtime';
import {
  createNetProbeCapabilityTools,
  createSshInspectCapabilityTools,
  NET_PROBE_CAPABILITY_REF,
  SSH_INSPECT_CAPABILITY_REF,
  type RuntimeToolBinding,
} from '@sage/tool-runtime';
import { enforceOutputContract } from './output-contract.js';

describe('package run capability tool injection & output contract', () => {
  const route = { adapterKind: 'openai-compatible' as const, baseUrl: 'https://provider.example/v1', modelId: 'model-x', apiKey: 'key-1' };

  it('injects net-probe tools when declared, runs multi-turn probe, and validates JSON output contract', async () => {
    const bindings = createNetProbeCapabilityTools({
      allowlistRaw: 'ok.example.com',
      dnsResolver: { async resolve() { return ['93.184.216.34']; } },
      clients: {
        async httpRequest() {
          return { statusCode: 200, headers: { 'content-type': 'text/html' }, body: new Uint8Array(Buffer.from('<html>ok</html>')) };
        },
        async tlsInspect() {
          return { authorized: true, protocol: 'TLSv1.3', validTo: '2027-01-01T00:00:00Z' };
        }
      }
    });
    const byName = new Map<string, RuntimeToolBinding>(bindings.map((b) => [b.name, b]));
    const tools: LiveProviderToolSpec[] = bindings.map((b) => ({ name: b.name, description: b.description, parameters: b.parameters }));
    const executeTool: LiveProviderToolExecutor = async (call, signal) => {
      const target = byName.get(call.name);
      if (target === undefined) return { content: '{"ok":false}', isError: true };
      return target.execute(call.arguments, signal);
    };

    let turn = 0;
    const client = createLivePackageAgentClient({
      route,
      tools,
      executeTool,
      invoker: async ({ piMessages, tools: seenTools }) => {
        expect(seenTools?.map((t) => t.name)).toEqual(['http_probe', 'tls_probe', 'tcp_probe']);
        turn += 1;
        if (turn === 1) {
          return {
            text: '',
            tokens: 20,
            done: false,
            toolCalls: [{ id: 'c-http', name: 'http_probe', arguments: { url: 'https://ok.example.com/' } }]
          };
        }
        const toolMsg = piMessages?.[piMessages.length - 1] as { role: string; content: Array<{ text: string }> };
        expect(toolMsg.role).toBe('toolResult');
        const payload = JSON.parse(toolMsg.content[0]!.text);
        expect(payload.ok).toBe(true);
        expect(payload.statusCode).toBe(200);
        return {
          text: JSON.stringify({ overallStatus: 'ok', summary: 'https://ok.example.com returned 200' }),
          tokens: 30
        };
      }
    });

    const run = client.run({
      schemaVersion: '1',
      runId: 'run-pkg-tools-client',
      input: 'audit ok.example.com',
      skillRefs: [],
      requiredCapabilities: ['events', 'tools'],
      limits: { maxTurns: 6, maxToolCalls: 10, maxTokens: 10_000, deadlineAt: new Date(Date.now() + 30_000).toISOString() }
    });
    const outcome = await run.result;
    expect(outcome.status).toBe('succeeded');
    expect(outcome.usage).toEqual({ turns: 2, toolCalls: 1, tokens: 50 });

    const schema = JSON.stringify({
      type: 'object',
      required: ['overallStatus', 'summary'],
      properties: {
        overallStatus: { type: 'string', enum: ['ok', 'warning', 'critical'] },
        summary: { type: 'string' }
      }
    });
    const validated = enforceOutputContract(outcome.output ?? '', { schema, files: ['report.json'] });
    expect(JSON.parse(validated)).toEqual({ overallStatus: 'ok', summary: 'https://ok.example.com returned 200' });
  });

  it('rejects tools capability when package does not declare runtime tools', async () => {
    const client = createLivePackageAgentClient({
      route,
      invoker: async () => ({ text: 'plain', tokens: 5 })
    });
    const run = client.run({
      schemaVersion: '1',
      runId: 'run-no-tools',
      input: 'hello',
      skillRefs: [],
      requiredCapabilities: ['events', 'tools'],
      limits: { maxTurns: 2, maxToolCalls: 4, maxTokens: 1_000, deadlineAt: new Date(Date.now() + 30_000).toISOString() }
    });
    const outcome = await run.result;
    expect(outcome.status).toBe('failed');
    expect(outcome.error?.code).toBe('HARNESS_CAPABILITY_MISSING');
    expect(NET_PROBE_CAPABILITY_REF).toBe('capability://net-probe-readonly/v1');
    expect(SSH_INSPECT_CAPABILITY_REF).toBe('capability://ssh-readonly-inspect/v1');
  });

  it('supports combined net-probe and ssh-readonly-inspect tools in one multi-turn run', async () => {
    const netBindings = createNetProbeCapabilityTools({
      allowlistRaw: 'ok.example.com',
      dnsResolver: { async resolve() { return ['93.184.216.34']; } },
      clients: {
        async httpRequest() {
          return { statusCode: 200, headers: {}, body: new Uint8Array(Buffer.from('ok')) };
        },
      },
    });
    const sshBindings = createSshInspectCapabilityTools({
      targetProvider: {
        async listTargets() {
          return [{
            alias: 'host-a',
            host: '203.0.113.10',
            port: 22,
            username: 'readonly',
            customChecks: {},
            enabled: true,
            credentialPresent: true,
          }];
        },
        async getTarget(alias) {
          return alias === 'host-a' ? (await this.listTargets())[0] : undefined;
        },
        async openPrivateKey() { return '-----BEGIN OPENSSH PRIVATE KEY-----\nZmFrZQ==\n-----END OPENSSH PRIVATE KEY-----\n'; },
      },
      commandRunner: async () => ({ stdout: 'readable=1\npasswordauthentication no\n', stderr: '', exitCode: 0 }),
    });
    const combined = [...netBindings, ...sshBindings];
    const byName = new Map<string, RuntimeToolBinding>(combined.map((b) => [b.name, b]));
    const tools: LiveProviderToolSpec[] = combined.map((b) => ({ name: b.name, description: b.description, parameters: b.parameters }));

    let turn = 0;
    const client = createLivePackageAgentClient({
      route,
      tools,
      executeTool: async (call, signal) => byName.get(call.name)!.execute(call.arguments, signal),
      invoker: async ({ tools: seenTools }) => {
        expect(seenTools?.map((t) => t.name)).toEqual(['http_probe', 'tls_probe', 'tcp_probe', 'ssh_list_targets', 'ssh_readonly_inspect']);
        turn += 1;
        if (turn === 1) {
          return { text: '', tokens: 10, done: false, toolCalls: [{ id: 'c1', name: 'http_probe', arguments: { url: 'https://ok.example.com/' } }] };
        }
        if (turn === 2) {
          return { text: '', tokens: 10, done: false, toolCalls: [{ id: 'c2', name: 'ssh_readonly_inspect', arguments: { hostAlias: 'host-a', check: 'sshd_policy' } }] };
        }
        return { text: JSON.stringify({ overallStatus: 'ok', summary: 'external and ssh ok' }), tokens: 15 };
      },
    });

    const outcome = await client.run({
      schemaVersion: '1',
      runId: 'run-combined-tools',
      input: 'full audit',
      skillRefs: [],
      requiredCapabilities: ['events', 'tools'],
      limits: { maxTurns: 6, maxToolCalls: 10, maxTokens: 10_000, deadlineAt: new Date(Date.now() + 30_000).toISOString() },
    }).result;

    expect(outcome.status).toBe('succeeded');
    expect(outcome.usage).toEqual({ turns: 3, toolCalls: 2, tokens: 35 });
  });
});
