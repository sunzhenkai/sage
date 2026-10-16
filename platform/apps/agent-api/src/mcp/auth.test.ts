import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { ServiceTokenAuthenticator } from '../service-token.js';
import { authenticateMcpRequest } from './auth.js';

const KEY = 'test-api-key-0123456789abcdef';
const HASH = createHash('sha256').update(KEY, 'utf8').digest('hex');
const WRONG_KEY = 'wrong-key';
const TENANT = 'tenant-test';

function makeAuthenticator(): ServiceTokenAuthenticator {
  return new ServiceTokenAuthenticator({ hashes: [HASH], tenantId: TENANT });
}

describe('authenticateMcpRequest', () => {
  it('正确 key：返回 principal + token', () => {
    const auth = authenticateMcpRequest({ headers: { authorization: `Bearer ${KEY}` } }, makeAuthenticator());
    expect(auth).toBeDefined();
    expect(auth!.principal.principalId).toMatch(/^service-token:\/\//);
    expect(auth!.principal.tenantId).toBe(TENANT);
    expect(auth!.token).toBe(KEY);
  });

  it('错误 key：返回 undefined', () => {
    const auth = authenticateMcpRequest({ headers: { authorization: `Bearer ${WRONG_KEY}` } }, makeAuthenticator());
    expect(auth).toBeUndefined();
  });

  it('缺失 Authorization 头：返回 undefined', () => {
    const auth = authenticateMcpRequest({ headers: {} }, makeAuthenticator());
    expect(auth).toBeUndefined();
  });

  it('非 Bearer 格式：返回 undefined', () => {
    const auth = authenticateMcpRequest({ headers: { authorization: `Basic ${KEY}` } }, makeAuthenticator());
    expect(auth).toBeUndefined();
  });

  it('env 未配置（serviceToken undefined）：fail-closed，任意 key 都 undefined', () => {
    const auth = authenticateMcpRequest({ headers: { authorization: `Bearer ${KEY}` } }, undefined);
    expect(auth).toBeUndefined();
  });

  it('多个 hash 轮换：任一命中即通过', () => {
    const other = createHash('sha256').update('other-key', 'utf8').digest('hex');
    const multi = new ServiceTokenAuthenticator({ hashes: [other, HASH], tenantId: TENANT });
    const auth = authenticateMcpRequest({ headers: { authorization: `Bearer ${KEY}` } }, multi);
    expect(auth).toBeDefined();
  });
});
