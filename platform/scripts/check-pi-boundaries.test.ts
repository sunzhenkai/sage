import { describe, expect, it } from 'vitest';

import { findPiBoundaryViolations } from './check-pi-boundaries.mjs';

const manifest = { dependencies: {}, devDependencies: {}, peerDependencies: {} };

const violations = (text: string, packageName = 'agent-runtime-conformance'): string[] => findPiBoundaryViolations({
  packageName,
  normalized: `packages/${packageName}/src/fixture.ts`,
  text,
  manifest
});

describe('Pi dependency/import boundary scanner', () => {
  it('allows Pi SDK imports only inside harness-pi', () => {
    expect(violations("import type { Agent } from '@mariozechner/pi-agent-core';")).toEqual([
      'packages/agent-runtime-conformance/src/fixture.ts: Pi SDK import is restricted to packages/harness-pi: @mariozechner/pi-agent-core'
    ]);
    expect(violations("import type { Agent } from '@mariozechner/pi-agent-core';", 'harness-pi')).toEqual([]);
  });

  it.each([
    ['provider SDK', "import { Client } from '@aws-sdk/client-bedrock-runtime';"],
    ['MCP SDK', "import { Client } from '@modelcontextprotocol/sdk/client/index.js';"],
    ['database driver', "import { Pool } from 'pg';"],
    ['authority package', "import { InMemoryConsumptionLedger } from '@sage/local-fakes';"]
  ])('rejects direct %s from the Pi adapter', (_name, source) => {
    expect(violations(source, 'harness-pi')).toHaveLength(1);
  });

  it('rejects authority-shaped serialized fields from the Pi adapter', () => {
    expect(violations('export const proposal = { providerClient: undefined };', 'harness-pi')).toEqual([
      'packages/harness-pi/src/fixture.ts: Pi adapter exposes forbidden authority field providerClient'
    ]);
  });

  it('restricts direct Pi SDK manifest dependencies to harness-pi', () => {
    expect(findPiBoundaryViolations({
      packageName: 'agent-lib',
      normalized: 'packages/agent-lib/package.json',
      text: '{}',
      manifest: { dependencies: { '@mariozechner/pi-ai': '0.73.1' } },
      isManifest: true
    })).toEqual([
      'packages/agent-lib/package.json: Pi SDK dependency is restricted to @sage/harness-pi: @mariozechner/pi-ai'
    ]);
    expect(findPiBoundaryViolations({
      packageName: 'harness-pi',
      normalized: 'packages/harness-pi/package.json',
      text: '{}',
      manifest: { dependencies: { '@mariozechner/pi-ai': '0.73.1' } },
      isManifest: true
    })).toEqual([]);
  });
});
