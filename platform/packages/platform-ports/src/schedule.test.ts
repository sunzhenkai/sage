import { describe, expect, it } from 'vitest';
import {
  assertScheduleDefinition,
  assertScheduleOccurrence,
  assertScheduleTriggerEvent,
  scheduleDefinitionDigest,
  scheduleOccurrenceKey,
  ScheduleDefinitionSchema,
  ScheduleSnapshotSchema,
  ScheduleTriggerEventSchema,
  ScheduleErrorCodeSchema,
  type ScheduleDefinition
} from './index.js';

const validDefinition: ScheduleDefinition = {
  schemaVersion: '1',
  scheduleId: 'daily-report',
  tenantId: 'tenant-a',
  displayName: '每日报告',
  trigger: { kind: 'cron', expression: '0 9 * * *', timezone: 'Asia/Shanghai' },
  overlapPolicy: 'SKIP',
  misfirePolicy: 'SKIP',
  releaseBinding: { strategy: 'FIXED', releaseId: 'release-1', contentDigest: `sha256:${'a'.repeat(64)}` },
  targetConstraints: { allowedEnvironments: ['local'] },
  budget: { limits: [{ dimension: 'runs', limit: 100 }] },
  invocation: { task: 'daily', params: { window: 7 } }
};

describe('canonical schedule contracts', () => {
  it('accepts a valid schedule definition and produces a stable digest', () => {
    assertScheduleDefinition(validDefinition);
    expect(scheduleDefinitionDigest(validDefinition)).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(scheduleDefinitionDigest(validDefinition)).toBe(scheduleDefinitionDigest({ ...validDefinition }));
  });

  it('rejects definitions with invalid ids, trigger rules, or extra fields', () => {
    expect(() => assertScheduleDefinition({ ...validDefinition, scheduleId: 'Bad Id!' })).toThrow('SCHEDULE_RULE_INVALID');
    expect(() => assertScheduleDefinition({
      ...validDefinition,
      trigger: { kind: 'cron', expression: '0 9 * * *', timezone: 'Asia/Shanghai', extra: 1 } as unknown as ScheduleDefinition['trigger']
    })).toThrow('SCHEDULE_RULE_INVALID');
    expect(() => assertScheduleDefinition({
      ...validDefinition,
      releaseBinding: { strategy: 'FIXED', releaseId: 'release-1' } as unknown as ScheduleDefinition['releaseBinding']
    })).toThrow('SCHEDULE_RULE_INVALID');
    expect(() => assertScheduleDefinition({
      ...validDefinition,
      budget: { limits: [{ dimension: 'runs', limit: 0 }] }
    })).toThrow('SCHEDULE_RULE_INVALID');
  });

  it('builds stable occurrence keys and rejects malformed occurrences', () => {
    const occurrence = { schemaVersion: '1' as const, scheduleId: 'daily-report', tenantId: 'tenant-a', occurrenceId: '2026-08-28T09:00:00Z', dueAtMs: 0 };
    expect(scheduleOccurrenceKey(occurrence)).toBe('schedule:daily-report:occ:2026-08-28T09:00:00Z');
    assertScheduleOccurrence(occurrence);
    expect(() => assertScheduleOccurrence({ ...occurrence, occurrenceId: 'bad id' })).toThrow('SCHEDULE_RULE_INVALID');
  });

  it('rejects legacy free-form invocation input', () => {
    expect(() => assertScheduleDefinition({
      ...validDefinition,
      invocation: { input: 'daily report instruction' } as unknown as ScheduleDefinition['invocation']
    })).toThrow('SCHEDULE_RULE_INVALID');
  });

  it('validates trigger events and bounds task references', () => {
    const event = {
      schemaVersion: '1' as const, scheduleId: 'daily-report', tenantId: 'tenant-a',
      occurrenceId: 'occ-1', kind: 'FAILED' as const, occurredAtMs: 1,
      taskId: 'task-1', errorCode: 'ADMISSION_FAIL_CLOSED'
    };
    assertScheduleTriggerEvent(event);
    expect(() => assertScheduleTriggerEvent({ ...event, kind: 'UNKNOWN' as never })).toThrow('SCHEDULE_TRIGGER_EVENT_INVALID');
  });

  it('exposes canonical schema ids without scheduler facility naming', () => {
    // typebox 的 TSchema 类型不声明 $id（运行时经 options 展开），用类型化读取断言。
    const schemaId = (schema: unknown): string | undefined => (schema as { readonly $id?: string }).$id;
    expect(schemaId(ScheduleDefinitionSchema)).toBe('ScheduleDefinition.v1');
    expect(schemaId(ScheduleSnapshotSchema)).toBe('ScheduleSnapshot.v1');
    expect(schemaId(ScheduleTriggerEventSchema)).toBe('ScheduleTriggerEvent.v1');
    expect(schemaId(ScheduleErrorCodeSchema)).toBe('ScheduleErrorCode.v1');
  });
});
