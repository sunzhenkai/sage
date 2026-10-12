import { describe, expect, it } from 'vitest';
import { DURABLE_REPLAY_CORPUS } from './replay-corpus.js';
import { runReplayGate, type ReplayGateRunners } from './replay-gate.js';

const digest = `sha256:${'a'.repeat(64)}` as const;
const runners = (): ReplayGateRunners => ({
  canonicalConformance: async () => ({ check:'canonical-conformance', status:'PASS', evidenceDigest:digest }),
  historyReplay: async () => ({ check:'history-replay', status:'PASS', evidenceDigest:digest }),
  oldReaderNewWriter: async () => ({ check:'old-reader-new-writer', status:'PASS', evidenceDigest:digest }),
  negativeNondeterminism: async () => ({ check:'negative-nondeterminism', status:'PASS', evidenceDigest:digest })
});

describe('durable replay gate', () => {
  it('passes only when every required check has a digest-backed PASS', async () => {
    await expect(runReplayGate(runners())).resolves.toMatchObject({ status:'PASS', corpusSize:DURABLE_REPLAY_CORPUS.length });
  });

  it('fails closed for skipped checks, missing evidence, or incomplete corpus', async () => {
    const skipped: ReplayGateRunners = { ...runners(), historyReplay: async () => ({ check:'history-replay', status:'SKIP', reason:'provider unavailable' }) };
    await expect(runReplayGate(skipped)).rejects.toThrow('REPLAY_GATE_FAILED');
    const noDigest: ReplayGateRunners = { ...runners(), canonicalConformance: async () => ({ check:'canonical-conformance', status:'PASS' }) };
    await expect(runReplayGate(noDigest)).rejects.toThrow('REPLAY_GATE_FAILED');
    await expect(runReplayGate(runners(), DURABLE_REPLAY_CORPUS.filter((entry) => entry.scenario !== 'effect-unknown'))).rejects.toThrow('REPLAY_CORPUS_SCENARIO_MISSING:effect-unknown');
  });
});
