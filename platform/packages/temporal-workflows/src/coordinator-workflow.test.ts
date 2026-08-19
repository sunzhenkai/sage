import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bundleWorkflowCode } from '@temporalio/worker';
import {
  DURABLE_COORDINATOR_STATE_QUERY, DURABLE_COORDINATOR_TASK_QUEUE, DURABLE_COORDINATOR_WORKFLOW_TYPE,
  normalizeTemporalCoordinatorError
} from './coordinator-workflow.js';

describe('DurableCoordinatorWorkflow v2 boundary', () => {
  it('publishes an independent workflow type and task queue', () => {
    expect(DURABLE_COORDINATOR_WORKFLOW_TYPE).toBe('DurableCoordinatorWorkflow.v1');
    expect(DURABLE_COORDINATOR_TASK_QUEUE).toBe('sage-durable-coordinator-v2');
    expect(DURABLE_COORDINATOR_STATE_QUERY).toBe('sage.coordinator.state.v1');
  });

  it('bundles independently from the legacy AgentTaskWorkflow module', async () => {
    const bundle = await bundleWorkflowCode({
      workflowsPath: fileURLToPath(new URL('./coordinator-workflow.ts', import.meta.url))
    });
    expect(bundle).toBeDefined();
    expect(bundle.code).toContain('DurableCoordinatorWorkflow');
  }, 30_000);

  it('normalizes edge failures without leaking Temporal identity fields', () => {
    expect(normalizeTemporalCoordinatorError({ name: 'ActivityNotFoundError', workflowId: 'wf-1', runId: 'run-1' })).toEqual({
      code: 'TARGET_UNAVAILABLE', safeMessage: 'TARGET_UNAVAILABLE', retryable: true
    });
    expect(normalizeTemporalCoordinatorError({ name: 'WorkflowExecutionAlreadyStartedError', buildId: 'build-1' })).toEqual({
      code: 'COORDINATOR_UNAVAILABLE', safeMessage: 'COORDINATOR_UNAVAILABLE', retryable: true
    });
    expect(normalizeTemporalCoordinatorError({ code: 'PERMISSION_DENIED', taskQueue: 'queue-1', message: 'sensitive detail' })).toEqual({
      code: 'COMMAND_NOT_AUTHORIZED', safeMessage: 'COMMAND_NOT_AUTHORIZED', retryable: false
    });
  });

  it('maps canonical lifecycle edges to Temporal primitives without legacy coupling', () => {
    const source = readFileSync(fileURLToPath(new URL('./coordinator-workflow.ts', import.meta.url)), 'utf8');
    expect(source).toContain('proxyActivities<DurableCoordinatorActivities>');
    expect(source).toContain('executeCoordinatorDispatch');
    expect(source).toContain('CancellationScope');
    expect(source).toContain('sleep(timeoutMs)');
    expect(source).toContain('condition(() => pendingCommands.length > 0 || pendingReceipts.length > 0)');
    expect(source).toContain('defineSignal<[CoordinatorCommand]>');
    expect(source).toContain('defineQuery<CoordinatorObservation>');
    expect(source).toContain('continueAsNew<typeof DurableCoordinatorWorkflow>');
    expect(source).toContain('MAX_COMMANDS_BEFORE_CONTINUE_AS_NEW');
    expect(source).toContain('createCarryState');
    expect(source).toContain('advanceLogicalCursor');
    expect(source).toContain("previousCursorRef: previous.cursorRef");
    expect(source).not.toContain("./workflows.js");
  });

  it('keeps forbidden provider, database, agent-library and body dependencies out of the workflow boundary', async () => {
    const workflowSource = readFileSync(
      fileURLToPath(new URL('./coordinator-workflow.ts', import.meta.url)),
      'utf8'
    );
    const packageManifest = JSON.parse(readFileSync(
      fileURLToPath(new URL('../package.json', import.meta.url)),
      'utf8'
    )) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; optionalDependencies?: Record<string, string> };
    const declaredDependencies = Object.keys({
      ...packageManifest.dependencies,
      ...packageManifest.devDependencies,
      ...packageManifest.optionalDependencies
    });
    const forbiddenPackages = [
      'openai', 'fastify', 'express', 'pg', 'postgres', 'mysql2', 'sqlite3', 'prisma', 'drizzle-orm',
      '@aws-sdk/client-s3', '@mariozechner/', '@modelcontextprotocol/', '@anthropic-ai/'
    ];
    const forbiddenBoundaryTokens = [
      'node:crypto', 'providerClient', 'databaseConnection', 'checkpointBody', 'artifactBody',
      'toolOutput', 'modelOutput', 'capabilityDefinition', 'contextSnapshot', 'memoryRecord',
      'agentLibrary', 'secretValue', 'credentialValue'
    ];

    for (const forbidden of forbiddenPackages) {
      expect(
        declaredDependencies.some((dependency) => dependency === forbidden || dependency.startsWith(forbidden)),
        `forbidden manifest dependency: ${forbidden}`
      ).toBe(false);
    }
    for (const forbidden of forbiddenBoundaryTokens) {
      expect(workflowSource, `forbidden workflow source token: ${forbidden}`).not.toContain(forbidden);
    }

    const bundle = await bundleWorkflowCode({
      workflowsPath: fileURLToPath(new URL('./coordinator-workflow.ts', import.meta.url))
    });
    for (const forbidden of forbiddenBoundaryTokens) {
      expect(bundle.code, `forbidden bundle token: ${forbidden}`).not.toContain(forbidden);
    }
    for (const forbidden of forbiddenPackages) {
      const packagePathToken = forbidden.endsWith('/')
        ? `node_modules/.pnpm/${forbidden.replaceAll('/', '+')}`
        : `node_modules/.pnpm/${forbidden}@`;
      expect(bundle.code, `forbidden transitive bundle dependency: ${forbidden}`).not.toContain(packagePathToken);
    }
  }, 30_000);
});
