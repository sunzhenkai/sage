import { describe, expect, it } from 'vitest';
import { assertReplayCorpusManifest, DURABLE_REPLAY_CORPUS } from './replay-corpus.js';

describe('durable replay corpus manifest', () => {
  it('covers legacy and coordinator schema/build windows plus every required scenario', () => {
    expect(() => assertReplayCorpusManifest()).not.toThrow();
    expect(DURABLE_REPLAY_CORPUS).toHaveLength(7);
    expect(new Set(DURABLE_REPLAY_CORPUS.map((entry) => entry.scenario))).toHaveProperty('size', 7);
  });

  it('rejects duplicate, malformed, or unbounded metadata', () => {
    expect(() => assertReplayCorpusManifest([...DURABLE_REPLAY_CORPUS, DURABLE_REPLAY_CORPUS[0]!])).toThrow('REPLAY_CORPUS_ENTRY_INVALID');
    expect(() => assertReplayCorpusManifest(DURABLE_REPLAY_CORPUS.map((entry) => ({ ...entry, fixtureDigest: 'sha256:not-a-digest' as `sha256:${string}` })))).toThrow('REPLAY_CORPUS_ENTRY_INVALID');
    expect(() => assertReplayCorpusManifest(Array.from({ length: 129 }, (_, index) => ({ ...DURABLE_REPLAY_CORPUS[index % DURABLE_REPLAY_CORPUS.length]!, caseId: `replay://extra/${index}` as `replay://${string}` })))).toThrow('REPLAY_CORPUS_UNBOUNDED_OR_EMPTY');
  });
});
