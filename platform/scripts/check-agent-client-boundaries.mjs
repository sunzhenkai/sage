import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const manifest = JSON.parse(readFileSync(resolve(root, 'packages/agent-client/package.json'), 'utf8'));
const source = readFileSync(resolve(root, 'packages/agent-client/src/index.ts'), 'utf8') + readFileSync(resolve(root, 'packages/agent-client/src/canonical.ts'), 'utf8');
const forbiddenImport = /@(mariozechner\/pi-|temporalio\/|model-broker|context-resolver|tool-runtime|provider|database|postgres|mcp)|\b(?:Temporal|MCP|Provider|Postgres|Prisma|Sequelize)\b/u;
const forbiddenDeps = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }).filter((name) => /pi-|temporal|provider|database|postgres|mcp|model-broker|context-resolver|tool-runtime/u.test(name));
if (forbiddenImport.test(source) || forbiddenDeps.length > 0) {
  throw new Error(`Agent Client public boundary violation: ${[...forbiddenDeps, ...(forbiddenImport.test(source) ? ['source'] : [])].join(',')}`);
}
process.stdout.write('Agent Client public boundaries: OK\n');
