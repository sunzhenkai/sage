#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const sensitiveKey = /(?:password|passwd|passphrase|secret|token|authorization|cookie|api[-_]?key|credential|private[-_]?key|restricted(?:_|-)?result)/i;
const sensitivePattern = /(?:bearer\s+[^\s"']+|(?:^|[^a-z0-9])(?:sk|token|secret)[-_][a-z0-9_-]{8,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i;
const referenceKey = /(?:^|_)(?:artifact|connection|secret|checkpoint|session|run|context|credential)_?ref$/i;
const referenceValue = /^(?:artifact|connection|secret|checkpoint|session|run|context):\/\/[^\s]+$/;

export function scanValue(value, source = '<memory>') {
  const findings = [];
  const visit = (current, path = '$') => {
    if (Array.isArray(current)) return current.forEach((item, index) => visit(item, `${path}[${index}]`));
    if (current && typeof current === 'object') {
      for (const [key, nested] of Object.entries(current)) {
        const nestedPath = `${path}.${key}`;
        if (referenceKey.test(key)) {
          if (typeof nested !== 'string' || !referenceValue.test(nested)) findings.push(`${source}:${nestedPath}: malformed reference`);
          continue;
        }
        if (sensitiveKey.test(key)) findings.push(`${source}:${nestedPath}: sensitive key`);
        visit(nested, nestedPath);
      }
      return;
    }
    if (typeof current === 'string' && sensitivePattern.test(current)) findings.push(`${source}:${path}: secret-like value`);
  };
  visit(value);
  return findings;
}

async function files(path) {
  const stat = await import('node:fs/promises').then(({ stat }) => stat(path));
  if (stat.isFile()) return [path];
  const entries = await readdir(path, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => files(join(path, entry.name))));
  return nested.flat();
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
  if (targets.length === 0) throw new Error('usage: fixture-scanner.mjs <json-file-or-directory> [...]');
  const result = await scanPaths(targets);
  if (result.findings.length) {
    console.error(result.findings.join('\n'));
    process.exitCode = 1;
  } else console.log(`P7 fixture secret scan: OK (${result.scanned} documents)`);
}
