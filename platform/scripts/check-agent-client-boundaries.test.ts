import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('agent-client public boundary', () => {
  it('passes the repository public dependency/import scan', () => {
    const output = execFileSync(process.execPath, ['scripts/check-agent-client-boundaries.mjs'], { encoding: 'utf8' });
    expect(output).toContain('Agent Client public boundaries: OK');
  });
});
