#!/usr/bin/env node
import { readFile, readdir, stat } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const sensitiveKey = /^(?:password|passwd|passphrase|secret|token|authorization|cookie|api[-_]?key|credential|private[-_]?key|restricted(?:_|-)?result|(?:access|refresh|auth|bearer|session)[-_]?(?:token|secret|credential))$/iu;
const physicalLocationKey = /(?:endpoint|url|uri|host(?:name)?|ip(?:address)?|namespace|task[-_]?queue|database|table(?:name)?|connection[-_]?string)/iu;
const queryKey = /(?:^|[-_])(?:sql|mql|query|statement)(?:$|[-_])/iu;
const piiKey = /(?:e[-_]?mail|phone|mobile|ssn|social[-_]?security|passport|street[-_]?address|full[-_]?name|first[-_]?name|last[-_]?name)/iu;
const secretPattern = /(?:bearer\s+[^\s"']+|(?:^|[^a-z0-9])(?:sk|token|secret)[-_][a-z0-9_-]{8,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/iu;
const endpointPattern = /(?:https?|wss?|grpc|postgres(?:ql)?|mysql|mongodb|redis|jdbc):\/\/|(?:^|\s)(?:localhost|(?:\d{1,3}\.){3}\d{1,3})(?::\d+)?(?:\s|$)/iu;
const sqlPattern = /\b(?:select\s+.+\s+from|insert\s+into|update\s+.+\s+set|delete\s+from|create\s+(?:table|database)|drop\s+(?:table|database)|match\s*\([^)]*\)\s*return\s+\w+)\b/iu;
const piiPattern = /(?:\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|\b\d{3}-\d{2}-\d{4}\b|(?:\+\d{1,3}[ -])?\d{3}[ -]\d{3}[ -]\d{4})/iu;
const referenceKey = /(?:ref|refs)$/iu;
const safeReference = /^(?:artifact|schema|skill|capability|context|model|package|release|spec|envelope|attempt|run|session|connection|secret|checkpoint|audit|trace):\/\/[^\s]+$/u;

export function scanValue(value, source = '<memory>') {
  const findings = [];
  const visit = (current, path = '$') => {
    if (Array.isArray(current)) return current.forEach((item, index) => visit(item, `${path}[${index}]`));
    if (current && typeof current === 'object') {
      for (const [key, nested] of Object.entries(current)) {
        const nestedPath = `${path}.${key}`;
        if (referenceKey.test(key)) {
          const refs = Array.isArray(nested) ? nested : [nested];
          if (refs.some((ref) => typeof ref !== 'string' || !safeReference.test(ref))) findings.push(`${source}:${nestedPath}: malformed reference`);
          continue;
        }
        if (sensitiveKey.test(key)) findings.push(`${source}:${nestedPath}: sensitive key`);
        if (physicalLocationKey.test(key)) findings.push(`${source}:${nestedPath}: physical endpoint key`);
        if (queryKey.test(key)) findings.push(`${source}:${nestedPath}: query key`);
        if (piiKey.test(key)) findings.push(`${source}:${nestedPath}: PII key`);
        visit(nested, nestedPath);
      }
      return;
    }
    if (typeof current !== 'string') return;
    if (secretPattern.test(current)) findings.push(`${source}:${path}: secret-like value`);
    if (endpointPattern.test(current)) findings.push(`${source}:${path}: physical endpoint value`);
    if (sqlPattern.test(current)) findings.push(`${source}:${path}: SQL/MQL-like value`);
    if (piiPattern.test(current)) findings.push(`${source}:${path}: PII-like value`);
  };
  visit(value);
  return findings;
}

async function files(path) {
  const metadata = await stat(path);
  if (metadata.isFile()) return [path];
  const entries = await readdir(path, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => files(join(path, entry.name))))).flat();
}

export async function scanPaths(paths) {
  const findings = [];
  let scanned = 0;
  for (const requested of paths) {
    for (const path of await files(resolve(requested))) {
      if (!['.json', '.jsonl'].includes(extname(path))) continue;
      const text = await readFile(path, 'utf8');
      const values = extname(path) === '.jsonl' ? text.split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [JSON.parse(text)];
      values.forEach((value, index) => findings.push(...scanValue(value, values.length === 1 ? path : `${path}:${index + 1}`)));
      scanned += values.length;
    }
  }
  return { scanned, findings };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const targets = process.argv.slice(2);
  if (targets.length === 0) throw new Error('usage: data-boundary-scanner.mjs <json-file-or-directory> [...]');
  const result = await scanPaths(targets);
  if (result.findings.length) {
    console.error(result.findings.join('\n'));
    process.exitCode = 1;
  } else console.log(`Phase 3 data-boundary scan: OK (${result.scanned} documents)`);
}
