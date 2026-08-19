import { assertReplayCorpusManifest, DURABLE_REPLAY_CORPUS, type ReplayCorpusEntry } from './replay-corpus.js';

export type ReplayGateCheck = 'canonical-conformance' | 'history-replay' | 'old-reader-new-writer' | 'negative-nondeterminism';
export interface ReplayGateResult { readonly check: ReplayGateCheck; readonly status: 'PASS' | 'FAIL' | 'SKIP'; readonly evidenceDigest?: `sha256:${string}`; readonly reason?: string }
export interface ReplayGateReport { readonly status: 'PASS'; readonly corpusSize: number; readonly checks: readonly ReplayGateResult[] }
export interface ReplayGateRunners {
  readonly canonicalConformance: (corpus: readonly ReplayCorpusEntry[]) => Promise<ReplayGateResult>;
  readonly historyReplay: (corpus: readonly ReplayCorpusEntry[]) => Promise<ReplayGateResult>;
  readonly oldReaderNewWriter: (corpus: readonly ReplayCorpusEntry[]) => Promise<ReplayGateResult>;
  readonly negativeNondeterminism: (corpus: readonly ReplayCorpusEntry[]) => Promise<ReplayGateResult>;
}

const expectedChecks: readonly ReplayGateCheck[] = ['canonical-conformance', 'history-replay', 'old-reader-new-writer', 'negative-nondeterminism'];
const isDigest = (value: string | undefined): value is `sha256:${string}` => value !== undefined && /^sha256:[a-f0-9]{64}$/u.test(value);

export async function runReplayGate(runners: ReplayGateRunners, corpus: readonly ReplayCorpusEntry[] = DURABLE_REPLAY_CORPUS): Promise<ReplayGateReport> {
  assertReplayCorpusManifest(corpus);
  const checks = await Promise.all([
    runners.canonicalConformance(corpus), runners.historyReplay(corpus),
    runners.oldReaderNewWriter(corpus), runners.negativeNondeterminism(corpus)
  ]);
  if (checks.length !== expectedChecks.length || checks.some((check, index) => check.check !== expectedChecks[index] || check.status !== 'PASS' || !isDigest(check.evidenceDigest))) {
    throw new Error('REPLAY_GATE_FAILED');
  }
  return Object.freeze({ status:'PASS', corpusSize:corpus.length, checks:Object.freeze(checks) });
}
