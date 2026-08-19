import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const targets = ['packages/chat-domain', 'apps/agent-api', 'apps/agent-web'];
const forbiddenImports = ['@mariozechner/pi-', '@sage/agent-lib', '@sage/harness-pi'];
const failures = [];

async function files(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await files(path));
    else if (/\.[cm]?[jt]sx?$/.test(entry.name) || entry.name === 'package.json') result.push(path);
  }
  return result;
}

for (const target of targets) {
  for (const file of await files(join(root, target))) {
    const text = await readFile(file, 'utf8');
    for (const forbidden of forbiddenImports) if (text.includes(forbidden)) failures.push(`${target}: forbidden Chat dependency ${forbidden} in ${file}`);
    if (/while\s*\([^)]*turn/i.test(text) || /executeTurn\s*\(/.test(text)) failures.push(`${target}: possible copied Agent Loop in ${file}`);
  }
}
const api = JSON.parse(await readFile(join(root, 'apps/agent-api/package.json'), 'utf8'));
if (api.dependencies?.['@sage/agent-client'] !== 'workspace:*') failures.push('agent-api must invoke Agent only through @sage/agent-client');
if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log('Chat dependency and Agent Loop boundaries: OK');
