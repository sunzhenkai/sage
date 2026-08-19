import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { TASK_TYPE, type RouteDecision, type TaskQueryResult } from '@sage/task-domain';
import { RoutingUnavailableError, WorkflowStartOutcomeUnknownError } from '@sage/temporal-routing';
import { registerTaskRoutes, type TaskControllerPort } from './task-api.js';

const result: TaskQueryResult = {
  workflow: { schemaVersion: '1', taskType: TASK_TYPE, taskId: 'task-api', workflowId: 'workflow-api', targetId: 'target-api', attempt: 1, status: 'running', committedSlices: 0, manualRetries: 0 },
  projectionFreshness: 'unavailable'
};
const authOptions={tenantId:'tenant-p5',authenticator:{authenticate:(id:string)=>id==='auth-p5'?{authenticationId:id,principalId:'p5-api',tenantId:'tenant-p5',roles:['task-operator']}:undefined},authorizer:{authorize:()=>true}} as const;
const authHeaders={'x-authentication-id':'auth-p5'} as const;
function controller(create: TaskControllerPort['create']): TaskControllerPort {
  return { create, async query() { return result; }, async signal() { return result; }, async cancel() { return result; }, async retry() { return result; } };
}

describe('P5 Task API trusted routing boundary', () => {
  it('recursively rejects unknown fields and normalized raw-target aliases before controller invocation', async () => {
    let invocations = 0;
    const app = Fastify({ logger: false });
    registerTaskRoutes(app, controller(async () => { invocations += 1; return result; }),authOptions);
    const aliases = ['endpoint', 'address', 'host', 'namespace', 'taskQueue', 'task_queue', 'queue', 'cluster', 'target', 'credential', 'secret', 'connection'];
    const spellings = (field: string): string[] => {
      const characters = [...field.replaceAll('_', '')];
      return [field, field.toUpperCase(), characters.join('_'), characters.join('-')];
    };
    const attacks: Record<string, unknown>[] = [
      { unknownField: 'untrusted' },
      { slice: { maxTurns: 1, unknownNested: true } },
      { slice: { endpoint: 'evil:7233' } },
      { taskId: { nested: { HOST: 'evil.example' } } }
    ];
    for (const alias of aliases) {
      for (const field of spellings(alias)) {
        attacks.push({ [field]: 'untrusted' }, { slice: { [field]: 'untrusted' } });
      }
    }
    for (const [index, attack] of attacks.entries()) {
      const response = await app.inject({
        method: 'POST', url: '/v1/tasks',
        payload: { taskId: `task-attack-${index}`, inputRef: 'task-input://p5/api', ...attack }
      });
      expect(response.statusCode, JSON.stringify(attack)).toBe(400);
      expect(response.json(), JSON.stringify(attack)).toMatchObject({ error: { code: 'TARGET_OVERRIDE_REJECTED', retryable: false } });
    }
    expect(invocations).toBe(0);
    await app.close();
  });

  it('preserves and accepts a legal Task create body', async () => {
    let captured: unknown;
    const app = Fastify({ logger: false });
    registerTaskRoutes(app, controller(async (body) => { captured = body; return result; }),authOptions);
    const body = {
      taskId: 'task-legal', taskType: TASK_TYPE, inputRef: 'task-input://p5/legal', maxSlices: 2, sliceDelayMs: 10,
      slice: { maxTurns: 1, maxToolCalls: 2, maxTokens: 1000, timeoutMs: 1000 }
    } as const;
    const response = await app.inject({ method: 'POST', url: '/v1/tasks', headers:authHeaders, payload: body });
    expect(response.statusCode).toBe(202);
    expect(captured).toEqual(body);
    await app.close();
  });

  it('returns ROUTING_UNAVAILABLE without invoking any API-local execution path', async () => {
    const decision: RouteDecision = {
      schemaVersion: '1', decisionId: 'route-api-none', taskId: 'task-api-none', taskType: TASK_TYPE, tenantId: 'tenant-p5',
      actorId: 'api', contextId: 'request', environment: 'development', region: 'us-east', residency: 'us',
      registryVersion: 'registry-none', policyVersion: 'policy-v1', candidates: [], rejectionCode: 'ROUTING_UNAVAILABLE',
      explanation: 'no legal target', decidedAt: new Date(0).toISOString()
    };
    const app = Fastify({ logger: false });
    registerTaskRoutes(app, controller(async () => { throw new RoutingUnavailableError(decision); }),authOptions);
    const response = await app.inject({ method: 'POST', url: '/v1/tasks', headers:authHeaders, payload: { taskId: 'task-api-none', inputRef: 'task-input://p5/api' } });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ error: { code: 'ROUTING_UNAVAILABLE', retryable: true, decisionId: 'route-api-none' } });
    await app.close();
  });

  it('returns a stable redacted outcome-unknown response with no provider or transport cause', async () => {
    const app = Fastify({ logger: false });
    registerTaskRoutes(app, controller(async () => { throw new WorkflowStartOutcomeUnknownError('sage-dev-us'); }),authOptions);
    const response = await app.inject({ method: 'POST', url: '/v1/tasks', headers:authHeaders, payload: { taskId: 'task-api-unknown', inputRef: 'task-input://p5/api' } });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: {
      code: 'WORKFLOW_START_OUTCOME_UNKNOWN',
      message: 'Workflow start outcome is not yet reconciled for target: sage-dev-us',
      retryable: true, targetId: 'sage-dev-us'
    } });
    expect(response.body).not.toContain('cause');
    await app.close();
  });

});
