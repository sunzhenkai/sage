import type { AdapterHealth } from '@sage/platform-ports';
import { ProductionAdmissionCoordinator, type ProductionAdmissionRequest } from '@sage/agent-run-admission';
import { BoundedProductionScheduler, type ProductionReadinessGate } from '@sage/production-governance';

export interface ProductionTopologyConfig {
  readonly environmentRef: string;
  readonly replicas: number;
  readonly faultDomains: number;
  readonly quorum: number;
  readonly failoverPlanRef: string;
  readonly pitrPlanRef: string;
  readonly retentionPolicyRef: string;
  readonly capacityHeadroomEvidenceRef: string;
}

export function assertProductionTopology(config: ProductionTopologyConfig): void {
  if (config.environmentRef !== 'production' || config.replicas < 3 || config.faultDomains < 3 || config.quorum < 2
    || [config.failoverPlanRef, config.pitrPlanRef, config.retentionPolicyRef, config.capacityHeadroomEvidenceRef].some(value => value.length === 0)) {
    throw new Error('PRODUCTION_TOPOLOGY_UNVERIFIED');
  }
}

export interface NamedProductionAdapter {
  readonly name: 'admission' | 'supply_chain' | 'identity' | 'policy' | 'acl' | 'grant' | 'approval' | 'consumption' | 'audit'
    | 'workload_identity' | 'secret_manager' | 'kms' | 'revocation' | 'effect_ledger' | 'consumption_ledger'
    | 'object_store' | 'coordinator' | 'sandbox' | 'egress';
  health(): Promise<AdapterHealth>;
}

export const REQUIRED_API_ADAPTERS: readonly NamedProductionAdapter['name'][] = [
  'admission', 'supply_chain', 'identity', 'policy', 'acl', 'grant', 'approval', 'consumption', 'audit',
  'workload_identity', 'secret_manager', 'kms', 'revocation', 'effect_ledger', 'consumption_ledger',
  'object_store', 'coordinator', 'sandbox', 'egress'
];

type AdmissionScheduler = BoundedProductionScheduler<ProductionAdmissionRequest, unknown>;

export class ProductionApiAdmissionRuntime {
  constructor(
    private readonly gate: ProductionReadinessGate,
    private readonly coordinator: ProductionAdmissionCoordinator,
    private readonly scheduler: AdmissionScheduler
  ) {
    if (!(coordinator instanceof ProductionAdmissionCoordinator)) throw new Error('PRODUCTION_ADMISSION_COORDINATOR_REQUIRED');
    if (!(scheduler instanceof BoundedProductionScheduler)) throw new Error('PRODUCTION_CAPACITY_CONTROLS_REQUIRED');
  }

  async admit(input: ProductionAdmissionRequest): Promise<unknown> {
    const readiness = await this.gate.evaluate();
    if (readiness.decision !== 'GO') throw Object.assign(new Error('NO_GO'), { code: 'NO_GO', reasons: readiness.reasonCodes });
    return this.scheduler.submit(input.requestedTenantId, input, request => this.coordinator.admit(request));
  }

  beginDrain(): void { this.scheduler.beginDrain(); }
  drain(timeoutMs: number): Promise<void> { return this.scheduler.drain(timeoutMs); }
  capacitySnapshot(): ReturnType<AdmissionScheduler['snapshot']> { return this.scheduler.snapshot(); }
}

export interface ProductionApiComposition {
  readonly runtime: ProductionApiAdmissionRuntime;
  readonly readiness: Awaited<ReturnType<ProductionReadinessGate['evaluate']>>;
  readonly adapters: readonly NamedProductionAdapter[];
}

export async function createProductionApiComposition(input: {
  readonly topology: ProductionTopologyConfig;
  readonly gate: ProductionReadinessGate;
  readonly coordinator: ProductionAdmissionCoordinator;
  readonly adapters: readonly NamedProductionAdapter[];
  readonly scheduler: AdmissionScheduler;
}): Promise<ProductionApiComposition> {
  assertProductionTopology(input.topology);
  if (!(input.coordinator instanceof ProductionAdmissionCoordinator)) throw new Error('PRODUCTION_ADMISSION_COORDINATOR_REQUIRED');
  if (input.scheduler === undefined) throw new Error('PRODUCTION_CAPACITY_CONTROLS_REQUIRED');
  const names = input.adapters.map(adapter => adapter.name);
  if (names.length !== REQUIRED_API_ADAPTERS.length || new Set(names).size !== names.length
    || !REQUIRED_API_ADAPTERS.every(name => names.includes(name))) throw new Error('PRODUCTION_ADAPTER_SET_INCOMPLETE');
  const health = await Promise.allSettled(input.adapters.map(adapter => adapter.health()));
  const failed = health.flatMap((result, index) => result.status === 'rejected' || !result.value.healthy ? [input.adapters[index]!.name] : []);
  if (failed.length) throw Object.assign(new Error('PRODUCTION_DEPENDENCY_UNAVAILABLE'), { dependencies: failed });
  const readiness = await input.gate.evaluate();
  if (readiness.decision !== 'GO') throw Object.assign(new Error('NO_GO'), { reasons: readiness.reasonCodes });
  return Object.freeze({
    runtime: new ProductionApiAdmissionRuntime(input.gate, input.coordinator, input.scheduler),
    readiness,
    adapters: Object.freeze([...input.adapters])
  });
}
