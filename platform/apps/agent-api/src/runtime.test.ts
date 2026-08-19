import { afterEach, describe, expect, it } from 'vitest';
import { readApiRuntimeConfig } from './runtime.js';

const original = { ...process.env };
afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key];
  for (const [key, value] of Object.entries(original)) process.env[key] = value;
});

describe('agent-api local runtime config', () => {
  it('requires local deployment mode and provides stable local defaults', () => {
    process.env.SAGE_DEPLOYMENT_MODE = 'local';
    delete process.env.SAGE_POSTGRES_URL;
    delete process.env.SAGE_TEMPORAL_ADDRESS;
    const config = readApiRuntimeConfig();
    expect(config).toMatchObject({ deploymentMode: 'local', tenantId: 'tenant-local', port: 3000, temporalAddress: '127.0.0.1:17233' });
    expect(config.principal.roles).toEqual(expect.arrayContaining(['chat-task-promoter', 'task-operator']));
  });

  it('rejects non-local deployment mode before opening listeners', () => {
    process.env.SAGE_DEPLOYMENT_MODE = 'development';
    expect(() => readApiRuntimeConfig()).toThrow('LOCAL_RUNTIME_REQUIRES_SAGE_DEPLOYMENT_MODE_LOCAL');
  });
});

  it('selects the canonical lifecycle owner before request wiring when kernel is allowlisted', () => {
    process.env.SAGE_DEPLOYMENT_MODE = 'local';
    process.env.SAGE_AGENT_EXECUTION_MODE = 'kernel';
    process.env.SAGE_AGENT_EXECUTION_ENVIRONMENT = 'local';
    process.env.SAGE_AGENT_TENANT_ALLOWLIST = 'tenant-local';
    process.env.SAGE_AGENT_WORKLOAD_ALLOWLIST = 'interactive-chat';
    const config = readApiRuntimeConfig();
    expect(config).toMatchObject({ executionMode: 'kernel', lifecycleOwner: 'canonical' });
  });
