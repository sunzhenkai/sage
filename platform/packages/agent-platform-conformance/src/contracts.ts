export type GateStatus = 'PASS' | 'FAIL' | 'BLOCKED';
export type ContentDigest = `sha256:${string}`;
export type CaseId = `apgv/${string}/v1/${string}`;

export interface ConformanceInvocation {
  readonly caseId: CaseId;
  readonly seed: string;
  readonly specDigest: ContentDigest;
  readonly releaseDigest: ContentDigest;
  readonly faultSchedule: readonly FaultPoint[];
}
export interface CanonicalObservation {
  readonly id: string;
  readonly type: string;
  readonly authority: string;
  readonly parents: readonly string[];
  readonly outcome?: string;
  readonly errorCode?: string;
  readonly receiptRefs?: readonly string[];
  readonly artifactRefs?: readonly string[];
  readonly checkpointRefs?: readonly string[];
  readonly budget?: Readonly<Record<string, number>>;
  readonly nonExact?: Readonly<Record<string, string>>;
}
export interface AdapterResult { readonly observations: readonly CanonicalObservation[]; readonly outcome: string; readonly errorCode?: string; }
export interface EngineAdapterFactory { readonly id: string; readonly buildDigest: ContentDigest; run(input: ConformanceInvocation): Promise<AdapterResult>; }
export interface HostDriver { readonly id: 'interactive' | 'durable'; readonly buildDigest: ContentDigest; run(input: ConformanceInvocation): Promise<AdapterResult>; }
export interface FaultPoint { readonly point: string; readonly trigger: number; readonly authority: string; readonly expectedRecovery: string; }
export interface FaultAdapter { arm(schedule: readonly FaultPoint[]): void; reached(point: string): boolean; }
export interface VirtualClockPort { now(): number; advance(milliseconds: number): void; }
export interface EvidenceEnvelope<T = unknown> { readonly schemaVersion: '1'; readonly caseId: CaseId; readonly seed: string; readonly sourceDigest: ContentDigest; readonly toolDigest: ContentDigest; readonly generatedAt: string; readonly status: GateStatus; readonly payload: T; readonly contentDigest: ContentDigest; }
export interface EvidenceWriter { write<T>(input: Omit<EvidenceEnvelope<T>, 'contentDigest'>): Promise<EvidenceEnvelope<T>>; }
