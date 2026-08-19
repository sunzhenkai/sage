import { createHash } from 'node:crypto';
import type { ContentDigest } from '@sage/agent-contracts';

export type CanonicalJsonValue = null | boolean | number | string | readonly CanonicalJsonValue[] | { readonly [key: string]: CanonicalJsonValue };
export interface CanonicalLimits { readonly maxBytes: number; readonly maxDepth: number; readonly maxArrayItems: number; readonly maxObjectKeys: number; readonly maxStringBytes: number }
export const DEFAULT_CANONICAL_LIMITS: CanonicalLimits = Object.freeze({ maxBytes: 64 * 1024, maxDepth: 16, maxArrayItems: 1024, maxObjectKeys: 1024, maxStringBytes: 16 * 1024 });
const utf8 = (value: string): number => new TextEncoder().encode(value).byteLength;
const fail = (code: string): never => { throw new TypeError(code); };

function canonical(value: unknown, depth: number, limits: CanonicalLimits): string {
  if (depth > limits.maxDepth) fail('CANONICAL_DEPTH_EXCEEDED');
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('CANONICAL_NUMBER_INVALID');
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (typeof value === 'string') {
    const normalized = value.normalize('NFC');
    if (utf8(normalized) > limits.maxStringBytes) fail('CANONICAL_STRING_EXCEEDED');
    return JSON.stringify(normalized);
  }
  if (Array.isArray(value)) {
    if (value.length > limits.maxArrayItems) fail('CANONICAL_ARRAY_EXCEEDED');
    return `[${value.map((item) => canonical(item, depth + 1, limits)).join(',')}]`;
  }
  if (typeof value !== 'object' || value instanceof Uint8Array) fail('CANONICAL_VALUE_INVALID');
  const record = value as Record<string, unknown>;
  const entries = Object.keys(record).map((key) => [key.normalize('NFC'), key] as const).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  if (entries.length > limits.maxObjectKeys) fail('CANONICAL_OBJECT_EXCEEDED');
  for (let index = 1; index < entries.length; index += 1) if (entries[index]?.[0] === entries[index - 1]?.[0]) fail('CANONICAL_NORMALIZED_KEY_COLLISION');
  return `{${entries.map(([normalized, original]) => `${JSON.stringify(normalized)}:${canonical(record[original], depth + 1, limits)}`).join(',')}}`;
}

export function canonicalJson(value: unknown, limits: CanonicalLimits = DEFAULT_CANONICAL_LIMITS): string {
  const output = canonical(value, 0, limits);
  if (utf8(output) > limits.maxBytes) fail('CANONICAL_BYTES_EXCEEDED');
  return output;
}

export function parseCanonicalJson(source: string, limits: CanonicalLimits = DEFAULT_CANONICAL_LIMITS): CanonicalJsonValue {
  if (utf8(source) > limits.maxBytes) fail('CANONICAL_BYTES_EXCEEDED');
  const stack: Array<Set<string> | undefined> = [];
  let inString = false, escaped = false;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (inString) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') inString = false; continue; }
    if (char === '"') {
      let end = i + 1, innerEscaped = false;
      for (; end < source.length; end += 1) { const c = source[end]; if (innerEscaped) innerEscaped = false; else if (c === '\\') innerEscaped = true; else if (c === '"') break; }
      let cursor = end + 1; while (/\s/.test(source[cursor] ?? '')) cursor += 1;
      if (source[cursor] === ':' && stack.at(-1)) { const key = (JSON.parse(source.slice(i, end + 1)) as string).normalize('NFC'); const frame = stack.at(-1)!; if (frame.has(key)) fail('CANONICAL_DUPLICATE_KEY'); frame.add(key); }
      i = end; continue;
    }
    if (char === '{') stack.push(new Set()); else if (char === '[') stack.push(undefined); else if (char === '}' || char === ']') stack.pop();
  }
  let parsed: unknown; try { parsed = JSON.parse(source); } catch { fail('CANONICAL_JSON_INVALID'); }
  canonicalJson(parsed, limits);
  return parsed as CanonicalJsonValue;
}

export const canonicalDigest = (value: unknown): ContentDigest => `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
export interface SemanticActionIdentity { readonly tenantId: string; readonly taskId: string; readonly attemptCompatibleActionKey: string; readonly toolVersion: string; readonly canonicalInputDigest: string }
export function semanticActionId(input: SemanticActionIdentity): ContentDigest {
  for (const [key, value] of Object.entries(input)) if (typeof value !== 'string' || value.length === 0) fail(`SEMANTIC_ACTION_${key.toUpperCase()}_INVALID`);
  if (!/^sha256:[a-f0-9]{64}$/.test(input.canonicalInputDigest)) fail('SEMANTIC_ACTION_INPUT_DIGEST_INVALID');
  return canonicalDigest(['semantic-action.v1', input.tenantId.normalize('NFC'), input.taskId.normalize('NFC'), input.attemptCompatibleActionKey.normalize('NFC'), input.toolVersion.normalize('NFC'), input.canonicalInputDigest]);
}
export function assertSemanticIdentityStable(existing: SemanticActionIdentity & { readonly semanticActionId: string }, proposed: SemanticActionIdentity): void {
  if (semanticActionId(proposed) !== existing.semanticActionId || canonicalJson(proposed) !== canonicalJson(({ tenantId: existing.tenantId, taskId: existing.taskId, attemptCompatibleActionKey: existing.attemptCompatibleActionKey, toolVersion: existing.toolVersion, canonicalInputDigest: existing.canonicalInputDigest }))) fail('EFFECT_CONFLICT');
}
