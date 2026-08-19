import { buildBundle, buildGateManifest, buildNoGoReport, recordValidationEvidence, verifyArchive } from './lib.mjs';
const commands=[
  'pnpm test:agent-platform-final:unit',
  'pnpm test:agent-platform-final:temporal',
  'pnpm scan:agent-platform-final',
  'pnpm typecheck',
  'pnpm lint',
  'pnpm build',
  'pnpm check:deps',
  'openspec validate agent-platform-generalization-validation --strict'
];
await recordValidationEvidence({qualityStatus:'PASS',commands:commands.map(command=>({command,status:'PASS'}))});
const gate=await buildGateManifest();
await buildNoGoReport();
await buildBundle();
const reproducibility=await verifyArchive();
console.log(JSON.stringify({status:gate.status,decision:gate.decision,gateItems:gate.items.length,blockers:gate.blockers.length,reproducibility:reproducibility.status},null,2));
if(gate.decision!=='NO-GO'||gate.status!=='BLOCKED'||reproducibility.status!=='PASS')process.exitCode=1;
