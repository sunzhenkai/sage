import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const workflowSource = await readFile(join(root, 'packages/temporal-workflows/src/workflows.ts'), 'utf8');
const workerSource = await readFile(join(root, 'apps/agent-worker/src/activities.ts'), 'utf8');
const manifest = JSON.parse(await readFile(join(root, 'packages/temporal-workflows/package.json'), 'utf8'));
const failures = [];
const allowed = new Set(['@sage/task-domain', '@sage/platform-ports', '@temporalio/workflow']);
for (const dependency of Object.keys(manifest.dependencies ?? {})) if (!allowed.has(dependency)) failures.push(`Workflow dependency forbidden: ${dependency}`);
for (const match of workflowSource.matchAll(/from\s+['"]([^'"]+)['"]/g)) if (!allowed.has(match[1])) failures.push(`Workflow import forbidden: ${match[1]}`);
for (const [name, pattern] of Object.entries({
  network: /\bfetch\s*\(|node:(?:http|https|net)|\bundici\b/,
  database: /\bnew\s+Pool\b|from\s+['"](?:pg|postgres)['"]/,
  agent: /@sage\/agent-(?:lib|client)|\bLocalAgentClient\b/,
  tool: /\bexecuteTurn\s*\(|\bToolPipeline\b/,
  external_io: /\b(?:ArtifactAdapter|SecretManagerAdapter|CredentialProvider)\b/,
  llm: /@mariozechner|\b(?:OpenAI|Anthropic)\b/
})) if (pattern.test(workflowSource)) failures.push(`Workflow ${name} I/O pattern found`);
if (!/import type \{[^}]*\bLocalAgentClient\b[^}]*\} from '@sage\/agent-client'/.test(workerSource)) failures.push('agent-worker must type-bind LocalAgentClient');
if (/^(?!import type\s+)[^;\n]*from ['"]@sage\/agent-lib|^(?!import type\s+)[^;\n]*from ['"]@sage\/harness-pi/um.test(workerSource)) failures.push('agent-worker bypasses LocalAgentClient');
if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log('P4 Workflow bundle/source/dependency boundaries: OK');
