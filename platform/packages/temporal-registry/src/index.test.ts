import { describe, expect, it } from 'vitest';
import {
  RegistryGovernanceError, VersionedTemporalRegistry, createDevRegistryBundle,
  type RegistryApprovalAuthorizer, type TemporalRegistryBundle
} from './index.js';

const authorization = { authenticationId: 'verified-human-session' } as const;
const authorizer: RegistryApprovalAuthorizer = {
  authenticate(context) {
    if (context.authenticationId === authorization.authenticationId) {
      return { principalId: 'human-change-approver', roles: ['temporal-registry-approver'] };
    }
    if (context.authenticationId === 'verified-owner-session') {
      return { principalId: 'control-plane-owner', roles: ['temporal-registry-approver'] };
    }
    if (context.authenticationId === 'verified-non-approver-session') {
      return { principalId: 'human-viewer', roles: ['temporal-registry-viewer'] };
    }
    return undefined;
  }
};
const registry = (now?: () => Date) => new VersionedTemporalRegistry({
  ownerId: 'control-plane-owner', registryId: 'sage-temporal-routing', approvalAuthorizer: authorizer, ...(now ? { now } : {})
});
const approve = (subject: VersionedTemporalRegistry, version: string) =>
  subject.approve(version, authorization, 'reviewed trusted routing controls');
const bumpTarget = (bundle: TemporalRegistryBundle, targetIndex: number, suffix: string): void => {
  const target = bundle.targets[targetIndex]!;
  bundle.targets[targetIndex] = { ...target, version: `${target.targetId}-${suffix}` };
};

describe('versioned Temporal Registry governance', () => {
  it('requires an authenticated approver role, distinct identity, strict context and service-generated approval fields', () => {
    const subject = registry(() => new Date('2026-08-12T00:00:00.000Z'));
    const bundle = createDevRegistryBundle('registry-v1');
    subject.submit(bundle, 'control-plane-owner', 'submit');
    expect(() => subject.approve(bundle.version, { authenticationId: 'unverified-string-claiming-human' }, 'reviewed'))
      .toThrowError(new RegistryGovernanceError('HUMAN_APPROVAL_REQUIRED'));
    expect(() => subject.approve(bundle.version, { authenticationId: 'verified-non-approver-session' }, 'reviewed'))
      .toThrowError(new RegistryGovernanceError('HUMAN_APPROVAL_REQUIRED'));
    expect(() => subject.approve(bundle.version, { authenticationId: 'verified-owner-session' }, 'reviewed'))
      .toThrowError(new RegistryGovernanceError('REGISTRY_SEPARATION_OF_DUTIES_REQUIRED'));
    expect(() => subject.approve(bundle.version, { authenticationId: 'verified-human-session', role: 'temporal-registry-approver' } as never, 'reviewed'))
      .toThrowError(new RegistryGovernanceError('REGISTRY_APPROVAL_AUTHORIZATION_INVALID'));
    expect(() => subject.approve(bundle.version, authorization, '   '))
      .toThrowError(new RegistryGovernanceError('REGISTRY_AUDIT_REASON_REQUIRED'));

    const approval = approve(subject, bundle.version);
    expect(approval).toMatchObject({
      approverId: 'human-change-approver', approverRole: 'temporal-registry-approver',
      authenticationId: 'verified-human-session', approvedAt: '2026-08-12T00:00:00.000Z',
      reason: 'reviewed trusted routing controls'
    });
    expect(approval.approvalId).toMatch(/^approval-/);
    expect(subject.publish(bundle.version, 'control-plane-owner', 'publish').bundle.targets).toHaveLength(2);
  });

  it('rejects same semantic artifact version mutation, credential rotation without a bump, and registryId drift', () => {
    const subject = registry();
    const first = createDevRegistryBundle('registry-v1');
    subject.submit(first, 'control-plane-owner', 'submit v1');
    approve(subject, first.version);
    subject.publish(first.version, 'control-plane-owner', 'publish v1');

    const sameVersionMutation = createDevRegistryBundle('registry-v2', { usBacklog: 10 });
    expect(() => subject.submit(sameVersionMutation, 'control-plane-owner', 'mutated same target version'))
      .toThrowError(new RegistryGovernanceError('REGISTRY_ARTIFACT_VERSION_IMMUTABLE'));

    const credentialRotation = createDevRegistryBundle('registry-v3');
    credentialRotation.targets[0] = { ...credentialRotation.targets[0]!, credentialRef: 'secret://temporal/rotated' };
    expect(() => subject.submit(credentialRotation, 'control-plane-owner', 'credential rotation without bump'))
      .toThrowError(new RegistryGovernanceError('REGISTRY_ARTIFACT_VERSION_IMMUTABLE'));

    const validRotation = createDevRegistryBundle('registry-v4');
    validRotation.targets[0] = { ...validRotation.targets[0]!, version: 'sage-dev-us-v2', credentialRef: 'secret://temporal/rotated' };
    subject.submit(validRotation, 'control-plane-owner', 'credential rotation with target profile bump');

    const wrongRegistry = createDevRegistryBundle('registry-v5');
    wrongRegistry.registryId = 'caller-selected-registry';
    expect(() => registry().submit(wrongRegistry, 'control-plane-owner', 'wrong registry'))
      .toThrowError(new RegistryGovernanceError('REGISTRY_ID_IMMUTABLE'));
  });

  it('retains immutable publication/audit history while rollback changes only the active approved version', async () => {
    const subject = registry(() => new Date('2026-08-12T01:00:00.000Z'));
    const v1 = createDevRegistryBundle('registry-v1');
    subject.submit(v1, 'control-plane-owner', 'submit registry-v1'); approve(subject, v1.version);
    subject.publish(v1.version, 'control-plane-owner', 'publish registry-v1');

    const v2 = createDevRegistryBundle('registry-v2', { usBacklog: 10 });
    bumpTarget(v2, 0, 'v2');
    subject.submit(v2, 'control-plane-owner', 'submit registry-v2'); approve(subject, v2.version);
    subject.publish(v2.version, 'control-plane-owner', 'publish registry-v2');

    expect((await subject.getActive()).bundle.version).toBe('registry-v2');
    subject.rollback('registry-v1', 'control-plane-owner', 'rollback after health review');
    expect((await subject.getActive()).bundle.version).toBe('registry-v1');
    expect(subject.publication('registry-v2')?.bundle.targets[0]?.backlog).toBe(10);
    expect(subject.auditLog().map(({ action, version }) => `${action}:${version}`)).toEqual([
      'submitted:registry-v1', 'approved:registry-v1', 'published:registry-v1',
      'submitted:registry-v2', 'approved:registry-v2', 'published:registry-v2', 'rollback:registry-v1'
    ]);
    expect(subject.auditLog().at(-1)).toMatchObject({
      registryId: 'sage-temporal-routing', fromVersion: 'registry-v2', actorId: 'control-plane-owner'
    });
  });
});
