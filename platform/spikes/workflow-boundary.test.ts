import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { bundleWorkflowCode } from '@temporalio/worker';
import { describe, expect, it } from 'vitest';

const workflowsPath = fileURLToPath(new URL('../packages/temporal-workflows/src/workflows.ts', import.meta.url));
const packagePath = fileURLToPath(new URL('../packages/temporal-workflows/package.json', import.meta.url));
const forbiddenBundleMarkers = [
  '@sage/agent-lib', '@sage/agent-client', '@mariozechner/', 'pg/lib', 'node:fs', 'node:http', 'node:https',
  'node:net', 'undici', 'node_modules/openai/', 'node_modules/@anthropic-ai/', 'LocalAgentClient', 'ArtifactAdapter', 'SecretManagerAdapter', 'CredentialProvider'
];

describe('AgentTaskWorkflow deterministic isolation', () => {
  it('has only approved direct dependencies and no I/O imports or calls in source', async () => {
    const source = await readFile(workflowsPath, 'utf8');
    const manifest = JSON.parse(await readFile(packagePath, 'utf8')) as { dependencies: Record<string, string> };
    expect(Object.keys(manifest.dependencies).sort()).toEqual(['@sage/platform-ports', '@sage/task-domain', '@temporalio/workflow']);
    const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
    expect(imports.every((specifier) => specifier === '@temporalio/workflow' || specifier === '@sage/task-domain')).toBe(true);
    for (const forbidden of [
      /\bfetch\s*\(/, /\bnew\s+Pool\b/, /\bLocalAgentClient\b/, /\bexecuteTurn\s*\(/,
      /\bArtifactAdapter\b/, /\bSecretManagerAdapter\b/, /\bCredentialProvider\b/, /\bprocess\.env\b/
    ]) expect(source).not.toMatch(forbidden);
  });

  it('bundles without Agent, database, network, Tool, Artifact/secret/credential, or LLM I/O implementations', async () => {
    const bundle = await bundleWorkflowCode({ workflowsPath });
    expect(bundle.code.length).toBeGreaterThan(100_000);
    for (const marker of forbiddenBundleMarkers) expect(bundle.code, marker).not.toContain(marker);
  }, 30_000);
});
