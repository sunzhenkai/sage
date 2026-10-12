import { createHash } from 'node:crypto';
import type { CaseId, ContentDigest, EvidenceEnvelope, EvidenceWriter, GateStatus } from './contracts.js';

export const canonicalize = (value: unknown): string => JSON.stringify(value, (_key, item: unknown) => {
  if (item !== null && typeof item === 'object' && !Array.isArray(item)) return Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)));
  return item;
});
export const digest = (value: unknown): ContentDigest => `sha256:${createHash('sha256').update(typeof value === 'string' ? value : canonicalize(value)).digest('hex')}`;
export function assertCaseId(value: string): asserts value is CaseId { if (!/^apgv\/[a-z0-9-]+\/v1\/[a-z0-9-]+$/u.test(value)) throw new TypeError('CASE_ID_INVALID'); }
export function assertDigest(value: string): asserts value is ContentDigest { if (!/^sha256:[a-f0-9]{64}$/u.test(value)) throw new TypeError('DIGEST_INVALID'); }
export function buildEvidence<T>(input: { caseId: CaseId; seed: string; sourceDigest: ContentDigest; toolDigest: ContentDigest; generatedAt: string; status: GateStatus; payload: T }): EvidenceEnvelope<T> {
  assertCaseId(input.caseId); assertDigest(input.sourceDigest); assertDigest(input.toolDigest);
  if (!['PASS', 'FAIL', 'BLOCKED'].includes(input.status) || input.seed.length === 0 || Number.isNaN(Date.parse(input.generatedAt))) throw new TypeError('EVIDENCE_METADATA_INVALID');
  return Object.freeze({ schemaVersion: '1', ...input, contentDigest: digest(input.payload) });
}
export const verifyEvidence = (value: EvidenceEnvelope): boolean => { try { assertCaseId(value.caseId); assertDigest(value.sourceDigest); assertDigest(value.toolDigest); assertDigest(value.contentDigest); return value.schemaVersion === '1' && digest(value.payload) === value.contentDigest; } catch { return false; } };
export class MemoryEvidenceWriter implements EvidenceWriter {
  readonly records: EvidenceEnvelope[] = [];
  async write<T>(input: Omit<EvidenceEnvelope<T>, 'contentDigest'>): Promise<EvidenceEnvelope<T>> { const record = buildEvidence(input); this.records.push(record); return record; }
}
