import { describe, expect, it } from 'vitest';

import { findDependencyBoundaryViolations, checkCanonicalPublicSurfaces } from './check-dependencies.mjs';

const forbiddenExternalPrefixes = [
  '@mariozechner/pi-',
  '@temporalio/',
  '@modelcontextprotocol/',
  '@aws-sdk/',
  'fastify',
  'pg',
];
const forbiddenSerializedKeys = [
  'piSession',
  'temporalWorkflowId',
  'providerClient',
  'httpRequest',
  'databaseConnection',
  'mcpClient',
];
const policy = {
  rules: {
    'agent-runtime-conformance': { owner: 'Quality', mayDependOn: ['agent-contracts'] },
  },
  hardConstraints: {
    'agent-runtime-conformance': { forbiddenExternalPrefixes, forbiddenSerializedKeys },
  },
};

function violations(text: string): string[] {
  return findDependencyBoundaryViolations({
    normalized: 'packages/agent-runtime-conformance/src/fixture.ts',
    packageName: 'agent-runtime-conformance',
    text,
    policy,
  });
}

describe('canonical dependency boundary scanner', () => {
  it('accepts framework-neutral contracts, fixtures and expectations', () => {
    expect(violations(`
      import type { AgentTaskSpec } from '@sage/agent-contracts';
      export interface Fixture { spec: AgentTaskSpec; providerBuildRef: string; runId: string }
      export const expectation = { outcome: 'completed', receiptRefs: ['receipt://run/1'] };
    `)).toEqual([]);
  });

  it.each([
    ['Pi', "import type { AgentSession } from '@mariozechner/pi-agent-core';"],
    ['Temporal', "import type { WorkflowClient } from '@temporalio/client';"],
    ['provider SDK', "import type { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';"],
    ['HTTP framework', "import type { FastifyRequest } from 'fastify';"],
    ['database driver', "import type { Pool } from 'pg';"],
    ['MCP SDK', "import type { Client } from '@modelcontextprotocol/sdk/client/index.js';"],
  ])('rejects direct %s dependencies', (_name, source) => {
    expect(violations(source)).toHaveLength(1);
  });

  it.each(forbiddenSerializedKeys)('rejects framework-shaped serialized field %s', (key) => {
    expect(violations(`export interface LeakedFixture { ${key}: unknown }`)).toEqual([
      `packages/agent-runtime-conformance/src/fixture.ts: forbidden serialized framework field ${key}`,
    ]);
  });
});


describe('canonical public surface leakage gate', () => {
  const canonicalPolicy = {
    rules: { 'platform-ports': { owner: 'Platform', mayDependOn: ['agent-contracts'] } },
    hardConstraints: {
      'platform-ports': {
        forbiddenSourceTokens: ['Temporal', 'WorkflowId', 'HistoryEvent', 'BuildId', 'TaskQueue'],
        forbiddenExternalPrefixes: ['@temporalio/'],
        forbiddenSerializedKeys: ['workflowId', 'historyEvent', 'buildId', 'taskQueue']
      }
    }
  };

  const canonicalViolations = (text: string): string[] => findDependencyBoundaryViolations({
    normalized: 'packages/platform-ports/src/index.ts', packageName: 'platform-ports', text, policy: canonicalPolicy
  });

  it('allows canonical run/signal-like names that are not framework DTOs', () => {
    expect(canonicalViolations('interface Observation { runId: string; signal: AbortSignal; }')).toEqual([]);
  });

  it.each([
    ['Temporal SDK import', "import type { WorkflowClient } from '@temporalio/client';"],
    ['Workflow ID type', 'type WorkflowId = string;'],
    ['History event type', 'type HistoryEvent = unknown;'],
    ['Build ID field', 'const value = { buildId: "x" };'],
    ['Task queue field', 'const value = { taskQueue: "x" };']
  ])('rejects %s from canonical implementation/public shape', (_name, source) => {
    expect(canonicalViolations(source).length).toBeGreaterThan(0);
  });

  it('passes the generated agent-contracts and platform-ports public surfaces', async () => {
    expect(await checkCanonicalPublicSurfaces()).toEqual([]);
  });
});


describe('Phase 3 package dependency boundaries', () => {
  const phase3ForbiddenSerializedKeys = [...forbiddenSerializedKeys, 'workflowId'];

const phase3Policy = {
    rules: {
      'agent-package-release': { owner: 'Package Platform', mayDependOn: ['agent-contracts'] },
      'agent-release-registry': { owner: 'Package Platform', mayDependOn: [] },
      'agent-run-admission': { owner: 'Package Platform', mayDependOn: ['agent-contracts', 'platform-ports'] }
    },
    hardConstraints: {
      'agent-package-release': { forbiddenExternalPrefixes, forbiddenSerializedKeys: phase3ForbiddenSerializedKeys, forbiddenSourceTokens: ['WorkflowId', 'HistoryEvent', 'TaskQueue'] },
      'agent-release-registry': { forbiddenExternalPrefixes, forbiddenSerializedKeys: phase3ForbiddenSerializedKeys, forbiddenSourceTokens: ['WorkflowId', 'HistoryEvent', 'TaskQueue'] },
      'agent-run-admission': { forbiddenExternalPrefixes, forbiddenSerializedKeys: phase3ForbiddenSerializedKeys, forbiddenSourceTokens: ['WorkflowId', 'HistoryEvent', 'TaskQueue'] }
    }
  };

  const phase3Violations = (packageName: string, source: string): string[] => findDependencyBoundaryViolations({
    normalized: `packages/${packageName}/src/index.ts`,
    packageName,
    text: source,
    policy: phase3Policy
  });

  it.each([
    ['agent-package-release', "import type { AgentRunner } from '@sage/agent-lib';"],
    ['agent-release-registry', "import type { AgentTaskSpecStorePort } from '@sage/platform-ports';"],
    ['agent-run-admission', "import type { AgentRunner } from '@sage/agent-lib';"]
  ])('rejects unauthorized canonical dependency from %s', (packageName, source) => {
    expect(phase3Violations(packageName, source)).toHaveLength(1);
    expect(phase3Violations(packageName, source)[0]).toContain('may not depend on');
  });

  it.each(['@temporalio/client', '@aws-sdk/client-bedrock-runtime', 'fastify', 'pg', '@modelcontextprotocol/sdk'])('rejects SDK leakage from Phase 3 packages: %s', (specifier) => {
    expect(phase3Violations('agent-run-admission', `import type { Leaked } from '${specifier}';`)).toHaveLength(1);
  });

  it.each(['workflowId', 'providerClient', 'databaseConnection', 'mcpClient'])('rejects framework-shaped serialized field %s', (key) => {
    expect(phase3Violations('agent-package-release', `export const leaked = { ${key}: true };`)).toEqual([
      `packages/agent-package-release/src/index.ts: forbidden serialized framework field ${key}`,
    ]);
  });
});
