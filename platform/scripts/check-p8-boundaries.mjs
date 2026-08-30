import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
const root = new URL('..', import.meta.url).pathname;
const read = (path) => readFile(join(root, path), 'utf8');
const exists = async (path) => { try { await readFile(join(root, path), 'utf8'); return true; } catch { return false; } };

// P8 边界检查（spec: ai-app-schedule-plane「canonical 依赖扫描」+ design D2/D3 纪律）：
// 1) canonical 契约（platform-ports）与公共 HTTP 契约（app-contracts）不出现任何调度设施 SDK 类型；
// 2) dispatcher workflow 无 I/O（确定性，禁 node 内建/数据库/网络）；
// 3) dispatcher workflow 类型与 occurrence 幂等键格式与 platform-ports 契约同构。
const [ports, contracts, workflows, admission] = await Promise.all([
  read('packages/platform-ports/src/index.ts'),
  read('packages/app-contracts/src/index.ts'),
  read('packages/temporal-schedules/src/workflows.ts'),
  read('packages/agent-run-admission/src/schedule-trigger.ts')
]);

const failures = [];
const require = (condition, message) => { if (!condition) failures.push(message); };

for (const token of ['@temporalio', 'ScheduleHandle', 'WorkflowClient', 'TemporalScheduleAdapter', 'auto-setup']) {
  require(!ports.includes(token), `canonical schedule contract leaks scheduler facility type: ${token}`);
  require(!contracts.includes(token), `public HTTP schedule contract leaks scheduler facility type: ${token}`);
}

for (const token of ['node:', "from 'pg'", 'child_process', 'fetch(', 'node-fetch', 'https', 'net']) {
  require(!workflows.includes(token), `dispatcher workflow must not perform I/O (found ${token})`);
}

require(workflows.includes("'ScheduleTriggerDispatcher.v1'"), 'dispatcher workflow type missing');
require(workflows.includes('`schedule:${scheduleId}:occ:${occurrenceId}`'), 'dispatcher occurrence key format drift');
require(admissionsHasKey(admission), 'admission idempotency key must include task and frozen params');

function admissionsHasKey(text) {
  return text.includes('sha256Digest([occurrenceKey, selectedTask.name, resolvedParams])');
}

// 边界脚本自身挂入 check:deps（若尚未接入）。
const pkg = JSON.parse(await read('package.json'));
require((pkg.scripts['check:deps'] ?? '').includes('check-p8-boundaries.mjs'), 'check-p8-boundaries must be part of check:deps');
require(await exists('packages/temporal-schedules/src/conformance.ts'), 'adapter-neutral conformance battery missing');

if (failures.length > 0) {
  for (const failure of failures) process.stderr.write(`P8 boundary violation: ${failure}\n`);
  process.exit(1);
}
process.stdout.write('P8 boundaries: OK\n');
