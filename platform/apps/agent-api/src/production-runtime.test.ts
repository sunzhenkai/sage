import Fastify, { type FastifyInstance } from 'fastify';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { ProductionAdmissionCoordinator, type ProductionAdmissionRequest } from '@sage/agent-run-admission';
import { BoundedProductionScheduler } from '@sage/production-governance';
import { TASK_TYPE, type TaskQueryResult } from '@sage/task-domain';
import { ProductionApiAdmissionRuntime, REQUIRED_API_ADAPTERS, assertProductionTopology, createProductionApiComposition } from './production-runtime.js';
import { registerTaskRoutes, type TaskControllerPort, type TaskRouteOptions } from './task-api.js';

const topology = { environmentRef: 'production', replicas: 3, faultDomains: 3, quorum: 2, failoverPlanRef: 'evidence://failover', pitrPlanRef: 'evidence://pitr', retentionPolicyRef: 'policy://retention', capacityHeadroomEvidenceRef: 'evidence://capacity' } as const;
const gate = (decision: 'GO' | 'NO_GO' = 'GO') => ({ evaluate: async () => ({ decision, reasonCodes: decision === 'GO' ? [] : ['READINESS_RECORD_MISSING'], ...(decision === 'GO' ? { recordRef: 'readiness://1' } : {}) }) }) as never;
const coordinator = () => {
  const value = new ProductionAdmissionCoordinator({} as never);
  vi.spyOn(value, 'admit').mockImplementation(async request => ({ admitted: request } as never));
  return value;
};
const scheduler = (queueLimit = 2) => new BoundedProductionScheduler<ProductionAdmissionRequest, unknown>([{ tenantId: 'tenant-a', weight: 1, concurrency: 1, queueLimit }], 1);
const adapters = () => REQUIRED_API_ADAPTERS.map(name => ({ name, health: async () => ({ healthy: true, checkedAt: new Date().toISOString() }) }));
const taskResult: TaskQueryResult = { workflow: { schemaVersion: '1', taskType: TASK_TYPE, taskId: 'task-1', workflowId: 'workflow-1', targetId: 'target-1', attempt: 1, status: 'running', committedSlices: 0, manualRetries: 0 }, projectionFreshness: 'unavailable' };
const taskController = (create = vi.fn(async () => taskResult)): TaskControllerPort => ({ create, query: async () => taskResult, signal: async () => taskResult, cancel: async () => taskResult, retry: async () => taskResult });
const principal = { authenticationId: 'auth', principalId: 'principal', tenantId: 'tenant-a', roles: ['task-operator'] };
const payload = (taskId: string) => ({ taskId, taskType: TASK_TYPE, inputRef: `task-input://tenant-a/${taskId}` });
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
};

function productionApp(runtime: ProductionApiAdmissionRuntime, controller: TaskControllerPort = taskController()): FastifyInstance {
  const app = Fastify({ logger: false });
  registerTaskRoutes(app, controller, {
    tenantId: 'tenant-a', deploymentMode: 'production',
    authenticator: { authenticate: id => id === principal.authenticationId ? principal : undefined },
    authorizer: { authorize: () => true }, accessAudit: { record: async () => undefined },
    productionAdmission: { runtime, drainTimeoutMs: 500, buildRequest: () => ({ requestedTenantId: 'tenant-a' } as ProductionAdmissionRequest) }
  });
  return app;
}

describe('production API runtime', () => {
  it('rejects unverified topology', () => expect(() => assertProductionTopology({ ...topology, replicas: 1 })).toThrow('PRODUCTION_TOPOLOGY_UNVERIFIED'));

  it('makes zero coordinator calls under NO-GO', async () => {
    const admission = coordinator();
    const runtime = new ProductionApiAdmissionRuntime(gate('NO_GO'), admission, scheduler());
    await expect(runtime.admit({ requestedTenantId: 'tenant-a' } as ProductionAdmissionRequest)).rejects.toMatchObject({ code: 'NO_GO' });
    expect(admission.admit).not.toHaveBeenCalled();
  });

  it('structurally excludes raw and generic coordinators from the public production route', () => {
    type PublicProductionRuntime = NonNullable<TaskRouteOptions['productionAdmission']>['runtime'];
    type GenericBoundedAdmissionShape = Pick<ProductionApiAdmissionRuntime, 'admit' | 'beginDrain' | 'drain' | 'capacitySnapshot'>;
    expectTypeOf<ProductionAdmissionCoordinator>().not.toExtend<PublicProductionRuntime>();
    expectTypeOf<GenericBoundedAdmissionShape>().not.toExtend<PublicProductionRuntime>();

    const app = Fastify();
    const raw = coordinator();
    expect(() => registerTaskRoutes(app, taskController(), {
      tenantId: 'tenant-a', deploymentMode: 'production',
      authenticator: { authenticate: () => principal }, authorizer: { authorize: () => true }, accessAudit: { record() {} },
      productionAdmission: { runtime: raw as never, buildRequest: () => ({ requestedTenantId: 'tenant-a' } as ProductionAdmissionRequest) }
    })).toThrow('PRODUCTION_ADMISSION_COMPOSITION_REQUIRED');
  });

  it('rejects readiness-only generic controllers and missing bounded controls', async () => {
    const genericAdmit = vi.fn();
    await expect(createProductionApiComposition({ topology, gate: gate(), coordinator: { admit: genericAdmit } as never, adapters: adapters(), scheduler: scheduler() }))
      .rejects.toThrow('PRODUCTION_ADMISSION_COORDINATOR_REQUIRED');
    expect(genericAdmit).not.toHaveBeenCalled();
    await expect(createProductionApiComposition({ topology, gate: gate(), coordinator: coordinator(), adapters: adapters(), scheduler: undefined as never }))
      .rejects.toThrow('PRODUCTION_CAPACITY_CONTROLS_REQUIRED');
  });

  it('fails startup for incomplete, duplicate, or unhealthy exact adapter sets', async () => {
    await expect(createProductionApiComposition({ topology, gate: gate(), coordinator: coordinator(), adapters: [], scheduler: scheduler() })).rejects.toThrow('PRODUCTION_ADAPTER_SET_INCOMPLETE');
    const duplicate = adapters().map(adapter => adapter.name === 'audit' ? { ...adapter, name: 'policy' as const } : adapter);
    await expect(createProductionApiComposition({ topology, gate: gate(), coordinator: coordinator(), adapters: duplicate, scheduler: scheduler() })).rejects.toThrow('PRODUCTION_ADAPTER_SET_INCOMPLETE');
    const unhealthy = REQUIRED_API_ADAPTERS.map(name => ({ name, health: async () => ({ healthy: name !== 'audit', checkedAt: new Date().toISOString() }) }));
    await expect(createProductionApiComposition({ topology, gate: gate(), coordinator: coordinator(), adapters: unhealthy, scheduler: scheduler() })).rejects.toThrow('PRODUCTION_DEPENDENCY_UNAVAILABLE');
  });

  it('requires the exact healthy production adapter set and supports bounded drain', async () => {
    const admission = coordinator();
    const composition = await createProductionApiComposition({ topology, gate: gate(), coordinator: admission, adapters: adapters(), scheduler: scheduler() });
    await expect(composition.runtime.admit({ requestedTenantId: 'tenant-a' } as ProductionAdmissionRequest)).resolves.toMatchObject({ admitted: { requestedTenantId: 'tenant-a' } });
    composition.runtime.beginDrain();
    await expect(composition.runtime.admit({ requestedTenantId: 'tenant-a' } as ProductionAdmissionRequest)).rejects.toThrow('PRODUCTION_DRAINING');
    await expect(composition.runtime.drain(100)).resolves.toBeUndefined();
  });

  it('routes production POST /v1/tasks only through the nominal runtime', async () => {
    const genericCreate = vi.fn(async () => taskResult);
    const controller = taskController(genericCreate);
    const missing = Fastify();
    expect(() => registerTaskRoutes(missing, controller, {
      tenantId: 'tenant-a', deploymentMode: 'production', authenticator: { authenticate: () => undefined }, authorizer: { authorize: () => true }
    })).toThrow('PRODUCTION_ADMISSION_COMPOSITION_REQUIRED');
    await missing.close();

    const admission = coordinator();
    const app = productionApp(new ProductionApiAdmissionRuntime(gate(), admission, scheduler()), controller);
    const response = await app.inject({ method: 'POST', url: '/v1/tasks', headers: { 'x-authentication-id': 'auth' }, payload: payload('task-1') });
    expect(response.statusCode).toBe(202);
    expect(admission.admit).toHaveBeenCalledOnce();
    expect(genericCreate).not.toHaveBeenCalled();
    await app.close();
  });

  it('enforces max concurrency one and rejects public queue overflow', async () => {
    const firstStarted = deferred(), secondStarted = deferred(), releaseFirst = deferred(), releaseSecond = deferred();
    let active = 0, maximumActive = 0, calls = 0;
    const admission = coordinator();
    vi.mocked(admission.admit).mockImplementation(async request => {
      calls += 1; active += 1; maximumActive = Math.max(maximumActive, active);
      if (calls === 1) { firstStarted.resolve(); await releaseFirst.promise; }
      else { secondStarted.resolve(); await releaseSecond.promise; }
      active -= 1;
      return { admitted: request } as never;
    });
    const runtime = new ProductionApiAdmissionRuntime(gate(), admission, scheduler(1));
    const app = productionApp(runtime);

    const first = app.inject({ method: 'POST', url: '/v1/tasks', headers: { 'x-authentication-id': 'auth' }, payload: payload('task-1') });
    await firstStarted.promise;
    const second = app.inject({ method: 'POST', url: '/v1/tasks', headers: { 'x-authentication-id': 'auth' }, payload: payload('task-2') });
    await vi.waitFor(() => expect(runtime.capacitySnapshot()).toMatchObject({ tenants: { 'tenant-a': { active: 1, queued: 1 } } }));
    const overflow = await app.inject({ method: 'POST', url: '/v1/tasks', headers: { 'x-authentication-id': 'auth' }, payload: payload('task-3') });
    expect(overflow.statusCode).toBe(429);
    expect(overflow.json()).toMatchObject({ error: { code: 'TENANT_BACKPRESSURE', retryable: true } });
    expect(maximumActive).toBe(1);

    releaseFirst.resolve();
    expect((await first).statusCode).toBe(202);
    await secondStarted.promise;
    expect(maximumActive).toBe(1);
    releaseSecond.resolve();
    expect((await second).statusCode).toBe(202);
    expect(admission.admit).toHaveBeenCalledTimes(2);
    await app.close();
  });

  it('rejects public requests after drain begins and drains on Fastify shutdown', async () => {
    const admission = coordinator();
    const runtime = new ProductionApiAdmissionRuntime(gate(), admission, scheduler(1));
    const beginDrain = vi.spyOn(runtime, 'beginDrain');
    const drain = vi.spyOn(runtime, 'drain');
    const app = productionApp(runtime);

    runtime.beginDrain();
    const response = await app.inject({ method: 'POST', url: '/v1/tasks', headers: { 'x-authentication-id': 'auth' }, payload: payload('task-late') });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ error: { code: 'PRODUCTION_DRAINING', retryable: true } });
    expect(admission.admit).not.toHaveBeenCalled();

    await app.close();
    expect(beginDrain).toHaveBeenCalledTimes(2);
    expect(drain).toHaveBeenCalledOnce();
  });
});
