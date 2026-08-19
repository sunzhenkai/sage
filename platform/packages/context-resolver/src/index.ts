import { createHash } from 'node:crypto';
import type { AdapterHealth, ContextResolverObservation, ContextResolverPort, ContextResolverRequest, ContextReceipt, ContextPlanSource } from '@sage/platform-ports';

export interface ContextPlanSnapshot {
  readonly planRef: string;
  readonly planDigest: string;
  readonly allowedSourceRefs: readonly string[];
  readonly requiredSourceRefs: readonly string[];
  readonly allowDegraded: boolean;
  readonly maxBytes: number;
  readonly maxTokens: number;
  readonly inlineSnapshotBytes: number;
}

export interface ContextSourceSnapshot extends ContextPlanSource {
  readonly tenantId: string;
  readonly principalRefs: readonly string[];
  readonly resourceRefs: readonly string[];
  readonly provenanceRef: string;
  readonly finalizedArtifactRef?: string;
}

export interface ContextPlanResolver {
  resolve(planRef: string): Promise<ContextPlanSnapshot | undefined>;
  health(): Promise<AdapterHealth>;
}

export interface ContextSourceResolver {
  get(input: { readonly tenantId: string; readonly sourceRef: string }): Promise<ContextSourceSnapshot | undefined>;
  health(): Promise<AdapterHealth>;
}

export class ContextResolverError extends Error {
  constructor(readonly code: string, message: string, readonly retryable = false, options?: ErrorOptions) { super(message, options); }
}

const digest = (value: unknown): string => `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
const bytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value), 'utf8');
const tokens = (value: string): number => value.trim() === '' ? 0 : value.trim().split(/\s+/u).length;
const scalar = (value: unknown): value is string | number | boolean => typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
const sourceKey = (source: ContextSourceSnapshot): string => digest({ revision: source.revision, content: source.content });

const validatePlan = (plan: ContextPlanSnapshot, request: ContextResolverRequest): void => {
  if (plan.planRef !== request.contextPlanRef || !plan.planDigest.startsWith('sha256:')) throw new ContextResolverError('CONTEXT_PLAN_INTEGRITY_MISMATCH', 'Context plan does not match the trusted Spec reference');
  if (!Number.isInteger(plan.maxBytes) || plan.maxBytes <= 0 || !Number.isInteger(plan.maxTokens) || plan.maxTokens <= 0 || !Number.isInteger(plan.inlineSnapshotBytes) || plan.inlineSnapshotBytes <= 0) throw new ContextResolverError('CONTEXT_PLAN_INVALID', 'Context plan bounds are invalid');
  if (new Set(plan.allowedSourceRefs).size !== plan.allowedSourceRefs.length || !plan.requiredSourceRefs.every((ref) => plan.allowedSourceRefs.includes(ref))) throw new ContextResolverError('CONTEXT_PLAN_INVALID', 'Context plan source allowlist is invalid');
};

/** Resolves only admission-frozen sources; source content is treated as untrusted data. */
export class SpecBoundContextResolver implements ContextResolverPort {
  constructor(readonly input: { readonly plans: ContextPlanResolver; readonly sources: ContextSourceResolver }) {}

  async resolve(request: ContextResolverRequest): Promise<ContextResolverObservation> {
    if (request.signal.aborted) throw new ContextResolverError('CANCELLED', 'Context resolution was cancelled', true);
    const plan = await this.input.plans.resolve(request.contextPlanRef);
    if (plan === undefined) throw new ContextResolverError('CONTEXT_PLAN_UNAVAILABLE', 'Context plan is unavailable', true);
    validatePlan(plan, request);
    if (request.allowedSourceRefs.some((ref) => !plan.allowedSourceRefs.includes(ref))) throw new ContextResolverError('CONTEXT_SOURCE_NOT_ALLOWED', 'Engine requested a source outside the Spec plan');
    const maxBytes = Math.min(request.maxBytes, plan.maxBytes);
    const maxTokens = Math.min(request.maxTokens, plan.maxTokens);
    const selected = [...new Set(request.allowedSourceRefs)];
    const loaded: ContextSourceSnapshot[] = [];
    const missing: string[] = [];
    for (const sourceRef of selected) {
      if (request.signal.aborted) throw new ContextResolverError('CANCELLED', 'Context resolution was cancelled', true);
      const source = await this.input.sources.get({ tenantId: request.identity.tenantId, sourceRef });
      if (source === undefined) { missing.push(sourceRef); continue; }
      if (source.tenantId !== request.identity.tenantId || (source.principalRefs.length > 0 && !source.principalRefs.includes(request.identity.principalRef)) || (source.resourceRefs.length > 0 && !source.resourceRefs.includes(request.identity.taskId))) throw new ContextResolverError('CONTEXT_ACCESS_DENIED', 'Context source ACL denied');
      if (source.finalizedArtifactRef === undefined && bytes(source.content) > plan.inlineSnapshotBytes) throw new ContextResolverError('CONTEXT_SNAPSHOT_NOT_FINALIZED', 'Large Context source requires a finalized ArtifactRef');
      if (!Object.values(source.content).every(scalar)) throw new ContextResolverError('CONTEXT_SOURCE_INVALID', 'Context source contains an unsupported value');
      loaded.push(source);
    }
    const missingRequired = plan.requiredSourceRefs.filter((ref) => missing.includes(ref));
    if (missingRequired.length > 0 || (missing.length > 0 && !plan.allowDegraded)) throw new ContextResolverError('CONTEXT_SOURCE_UNAVAILABLE', 'Required Context source is unavailable', true);
    const unique = new Set<string>();
    const view: Record<string, string | number | boolean> = {};
    let usedBytes = 2;
    let usedTokens = 0;
    let truncated = false;
    const accepted: ContextSourceSnapshot[] = [];
    for (const source of loaded.sort((a, b) => a.sourceRef.localeCompare(b.sourceRef))) {
      const key = sourceKey(source);
      if (unique.has(key)) continue;
      unique.add(key);
      let acceptedAny = false;
      const isLargeSnapshot = bytes(source.content) > plan.inlineSnapshotBytes;
      if (isLargeSnapshot) {
        const artifactRef = source.finalizedArtifactRef;
        if (artifactRef === undefined) throw new ContextResolverError('CONTEXT_SNAPSHOT_NOT_FINALIZED', 'Large Context source requires a finalized ArtifactRef');
        const candidateBytes = bytes({ snapshotRef: artifactRef });
        if (usedBytes + candidateBytes > maxBytes || usedTokens + 1 > maxTokens) { truncated = true; continue; }
        view[`${source.sourceRef}:snapshotRef`] = artifactRef;
        usedBytes += candidateBytes;
        usedTokens += 1;
        accepted.push(source);
        continue;
      }
      for (const [name, value] of Object.entries(source.content).sort(([a], [b]) => a.localeCompare(b))) {
        const candidateTokens = typeof value === 'string' ? tokens(value) : 1;
        const candidateBytes = bytes({ [name]: value });
        if (usedBytes + candidateBytes > maxBytes || usedTokens + candidateTokens > maxTokens) { truncated = true; continue; }
        view[name] = value;
        usedBytes += candidateBytes;
        usedTokens += candidateTokens;
        acceptedAny = true;
      }
      if (acceptedAny) accepted.push(source);
      if (acceptedAny && (Object.keys(source.content).length > Object.keys(view).length)) truncated = true;
    }
    const receipt: ContextReceipt = {
      receiptRef: `context-receipt://${request.identity.invocationId}`,
      sourceRefs: accepted.map((source) => source.sourceRef),
      revisions: accepted.map((source) => source.revision),
      truncated,
      degraded: missing.length > 0,
      provenanceRefs: accepted.map((source) => source.provenanceRef),
      sensitivity: accepted.reduce<'public' | 'internal' | 'restricted'>((current, source) => current === 'restricted' || source.sensitivity === 'restricted' ? 'restricted' : current === 'internal' || source.sensitivity === 'internal' ? 'internal' : 'public', 'public'),
      omittedSourceRefs: [...missing],
      artifactRefs: [...new Set(accepted.flatMap((source) => source.finalizedArtifactRef === undefined ? [] : [source.finalizedArtifactRef]))]
    };
    return { view, receipt };
  }

  async health(): Promise<AdapterHealth> {
    try {
      const [plans, sources] = await Promise.all([this.input.plans.health(), this.input.sources.health()]);
      return { healthy: plans.healthy && sources.healthy, checkedAt: new Date().toISOString(), ...(plans.healthy && sources.healthy ? {} : { detail: 'context-dependency-unhealthy' }) };
    } catch { return { healthy: false, checkedAt: new Date().toISOString(), detail: 'context-dependency-unavailable' }; }
  }
}
