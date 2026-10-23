import { describe, expect, it } from 'vitest';
import {
  addModel, connectionModelList, defaultSelectionKey, extraModels, MAX_CONNECTION_MODELS, parseSelectionKey, pickerOptions, promoteDefault, selectionKey
} from './connection-models';

describe('connection model lists', () => {
  it('keeps the default first and de-duplicates trimmed ids', () => {
    expect(connectionModelList('gpt-4o', [' gpt-4o-mini ', 'gpt-4o', '', 'gpt-4o-mini'])).toEqual(['gpt-4o', 'gpt-4o-mini']);
    expect(connectionModelList('gpt-4o', undefined)).toEqual(['gpt-4o']);
    expect(extraModels('gpt-4o', ['gpt-4o', 'o3'])).toEqual(['o3']);
  });

  it('adds models only when valid, new and under the cap', () => {
    expect(addModel('a', [], ' b ')).toEqual(['b']);
    expect(addModel('a', ['b'], 'a')).toEqual(['b']);
    expect(addModel('a', ['b'], '   ')).toEqual(['b']);
    expect(addModel('a', [], 'x'.repeat(257))).toEqual([]);
    const full = Array.from({ length: MAX_CONNECTION_MODELS - 1 }, (_, i) => `m${i}`);
    expect(addModel('a', full, 'one-more')).toEqual(full);
  });

  it('promotes another model to default and keeps the previous default allowed', () => {
    expect(promoteDefault('a', ['b', 'c'], 'c')).toEqual({ modelId: 'c', extras: ['a', 'b'] });
    expect(promoteDefault('a', ['b'], 'zzz')).toEqual({ modelId: 'a', extras: ['b'] });
  });
});

describe('chat model selection', () => {
  it('round-trips selection keys', () => {
    expect(parseSelectionKey(selectionKey('conn-1', 'org/model:v1'))).toEqual({ connectionId: 'conn-1', modelId: 'org/model:v1' });
    expect(parseSelectionKey('conn-legacy')).toEqual({ connectionId: 'conn-legacy' });
    expect(parseSelectionKey('')).toBeUndefined();
  });

  it('groups options per connection labeled connection / model', () => {
    const options = pickerOptions([
      { id: 'conn-a', name: 'openai', available: true, modelId: 'gpt-4o', models: ['gpt-4o', 'o3'] },
      { id: 'conn-b', name: 'legacy', available: false }
    ]);
    expect(options.map((o) => [o.label, o.isDefault, o.disabled])).toEqual([
      ['openai / gpt-4o', true, false], ['openai / o3', false, false], ['legacy', true, true]
    ]);
    expect(options[1]).toMatchObject({ connectionId: 'conn-a', modelId: 'o3' });
    expect(defaultSelectionKey([{ id: 'conn-a', name: 'openai', available: true, modelId: 'gpt-4o', models: ['o3'] }], 'conn-a')).toBe(selectionKey('conn-a', 'gpt-4o'));
    expect(defaultSelectionKey([], 'conn-a')).toBe('');
  });
});
