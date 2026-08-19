import { describe, expect, it } from 'vitest';
import { scanPaths, scanValue } from './data-boundary-scanner.mjs';

describe('Phase 3 Package/Release/runtime/audit/telemetry data-boundary scanner', () => {
  it('accepts reference-only Package, Release, Spec, Envelope, History, audit, log and trace fixtures', async () => {
    const result = await scanPaths([
      new URL('../../fixtures/phase3/', import.meta.url).pathname,
      new URL('../../fixtures/reference-workload/controlled-summary/agent-package.json', import.meta.url).pathname
    ]);
    expect(result.scanned).toBe(2);
    expect(result.findings).toEqual([]);
  });

  it('rejects secret bytes, physical endpoints, SQL/MQL and PII in every output shape', () => {
    expect(scanValue({ release: { access_token: 'secret_12345678' } })).toEqual(expect.arrayContaining([
      expect.stringContaining('sensitive key'), expect.stringContaining('secret-like value')
    ]));
    expect(scanValue({ spec: { endpoint: 'https://provider.invalid/v1' } })).toEqual(expect.arrayContaining([
      expect.stringContaining('physical endpoint key'), expect.stringContaining('physical endpoint value')
    ]));
    expect(scanValue({ history: { statement: 'SELECT password FROM users' } })).toEqual(expect.arrayContaining([
      expect.stringContaining('query key'), expect.stringContaining('SQL/MQL-like value')
    ]));
    expect(scanValue({ trace: { customer_email: 'person@example.com' } })).toEqual(expect.arrayContaining([
      expect.stringContaining('PII key'), expect.stringContaining('PII-like value')
    ]));
  });

  it('allows opaque reference schemes but rejects malformed reference fields', () => {
    expect(scanValue({ credentialRef: 'secret://tenant/provider-key', artifactRefs: ['artifact://tenant/output'] })).toEqual([]);
    expect(scanValue({ credentialRef: 'raw-provider-key', artifactRefs: ['https://storage.invalid/output'] })).toEqual([
      '<memory>:$.credentialRef: malformed reference', '<memory>:$.artifactRefs: malformed reference'
    ]);
  });
});
