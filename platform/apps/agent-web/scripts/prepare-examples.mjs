#!/usr/bin/env node
// Materialize the repository's example AI app source packages as Vite public assets.
import { cp, mkdir, rm, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(appRoot, '..', '..', 'examples', 'ai-apps');
const target = join(appRoot, 'public', 'examples', 'ai-apps');
const required = ['finance-briefing', 'github-trending', 'lifecycle-probe'];

try {
  if (!(await stat(source)).isDirectory()) throw new Error('not a directory');
} catch {
  console.error(`Example app source directory not found: ${source}`);
  process.exit(1);
}
const missing = [];
for (const id of required) {
  try { await stat(join(source, id, 'app.yaml')); } catch { missing.push(id); }
}
if (missing.length > 0) {
  console.error(`Example app packages missing app.yaml: ${missing.join(', ')}`);
  process.exit(1);
}
await rm(target, { recursive: true, force: true });
await mkdir(dirname(target), { recursive: true });
await cp(source, target, { recursive: true });
console.log(`Prepared example apps: ${required.join(', ')} -> public/examples/ai-apps`);
