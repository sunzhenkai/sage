import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const REFERENCE_WORKLOAD_ROOT = 'fixtures/reference-workload/controlled-summary/';
export const PROTECTED_REFERENCE_WORKLOAD_PATHS = Object.freeze([
  'packages/agent-contracts/',
  'packages/agent-lib/',
  'packages/platform-ports/',
  'packages/agent-run-admission/',
  'apps/agent-api/',
  'apps/agent-worker/',
  'packages/task-domain/',
  'packages/task-store-postgres/',
  'packages/agent-state-postgres/',
  'packages/temporal-workflows/',
  'packages/temporal-routing/',
  'packages/temporal-registry/',
]);

const workloadOwned = (path) => path === REFERENCE_WORKLOAD_ROOT.slice(0, -1)
  || path.startsWith(REFERENCE_WORKLOAD_ROOT)
  || path === 'platform/fixtures/reference-workload/controlled-summary'
  || path.startsWith('platform/fixtures/reference-workload/controlled-summary/');

export function findReferenceWorkloadBoundaryViolations(changedPaths) {
  const failures = [];
  for (const rawPath of changedPaths) {
    const path = rawPath.replaceAll('\\', '/').replace(/^\.?\//, '');
    if (PROTECTED_REFERENCE_WORKLOAD_PATHS.some((prefix) => path.startsWith(prefix))) {
      failures.push(`${path}: reference workload may not modify protected platform path`);
      continue;
    }
    if (!workloadOwned(path)) {
      failures.push(`${path}: reference workload change is outside its declaration-only ownership root`);
    }
  }
  return failures;
}

export function findReferenceWorkloadSourceViolations(files) {
  const failures = [];
  for (const [path, source] of files) {
    if (!workloadOwned(path)) continue;
    if (/\b(?:TaskType|taskType)\s*(?:===|switch|case)/u.test(source)) {
      failures.push(`${path}: reference workload must not add a business TaskType switch`);
    }
    if (/\b(?:Kernel|AgentRuntimeKernel|LocalAgentClient|DurableCoordinator)\b/u.test(source)
      && /(?:import|from|require|new\s)/u.test(source)) {
      failures.push(`${path}: reference workload must not import or construct platform runtime authority`);
    }
  }
  return failures;
}

function changedPathsFromGit(base) {
  const output = execFileSync('git', ['diff', '--name-only', '--diff-filter=ACMRTUXB', `${base}...HEAD`], { encoding: 'utf8' });
  return output.split('\n').map((line) => line.trim()).filter(Boolean);
}

async function main() {
  const baseIndex = process.argv.indexOf('--base');
  const base = baseIndex >= 0 ? process.argv[baseIndex + 1] : undefined;
  const files = base === undefined ? [] : changedPathsFromGit(base);
  const failures = findReferenceWorkloadBoundaryViolations(files);
  if (failures.length > 0) {
    console.error(`Reference workload boundary violations:\n${failures.map((failure) => `- ${failure}`).join('\n')}`);
    process.exit(1);
  }
  console.log(`Reference workload ownership gate: OK (${files.length} changed paths inspected)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
