import type { FastifyInstance, FastifyReply } from 'fastify';
import { Value } from 'typebox/value';
import { ApiEffectResolutionOutcomeSchema, ApiEffectResolutionSubmitRequestSchema, type ApiEffectResolutionOutcome } from '@sage/app-contracts';
import type { ToolEffectLedgerPort, TrustedPrincipal } from '@sage/platform-ports';
import { EffectResolutionService } from './effect-resolution.js';

/**
 * P8 统一裁决端点（D6，spec: unattended-run-autonomy「EFFECT_UNKNOWN 人工裁决协议」）：
 * `POST /v1/effects/resolutions`——裁决结论（CONFIRMED_COMMITTED / CONFIRMED_NOT_COMMITTED / ABANDONED）
 * + 处理动作（CONTINUE_NEW_ATTEMPT / TERMINATE）。
 * - 裁决落 append-only 审计（EffectResolutionService → agent_effect_resolutions），重复冲突拒绝；
 * - 未裁决前 action key 的自动重试保持阻断（既有 TASK_EFFECT_UNKNOWN_REQUIRES_RESOLUTION）；
 * - 「未提交 + 继续」→ 经任务控制面以新 attempt 重试（新 Spec/attempt，原 effect 可追溯）；
 * - 「已提交 + 继续」→ 重试再次放行，Effect Ledger replay 幂等保证不重复副作用；
 * - TERMINATE → 终止任务（终态审计留痕）。
 */

export interface EffectResolutionTaskControl {
  retry(taskId: string): Promise<unknown>;
  cancel(taskId: string): Promise<unknown>;
}

export interface RegisterEffectResolutionsRouteOptions {
  readonly service: EffectResolutionService;
  readonly ledger: ToolEffectLedgerPort;
  readonly authenticator: { authenticate(input: { readonly authorization?: string; readonly expectedAudience: string }): Promise<TrustedPrincipal> };
  readonly expectedAudience: string;
  readonly taskControl?: EffectResolutionTaskControl;
}

const sendError = (reply: FastifyReply, status: number, code: string, retryable = false): FastifyReply =>
  reply.code(status).send({ error: { code, message: code, retryable } });

export function registerEffectResolutionsRoute(app: FastifyInstance, options: RegisterEffectResolutionsRouteOptions): void {
  app.post<{ Body: unknown }>('/v1/effects/resolutions', async (request, reply) => {
    try {
      const principal = await options.authenticator.authenticate({ expectedAudience: options.expectedAudience, ...(request.headers.authorization === undefined ? {} : { authorization: request.headers.authorization }) });
      const body = request.body ?? {};
      if (!Value.Check(ApiEffectResolutionSubmitRequestSchema, body)) return sendError(reply, 400, 'EFFECT_RESOLUTION_INVALID');
      const submit = body as { readonly semanticActionId: string; readonly originalExecutorRef: string; readonly decision: 'CONFIRMED_COMMITTED' | 'CONFIRMED_NOT_COMMITTED' | 'ABANDONED'; readonly action: 'CONTINUE_NEW_ATTEMPT' | 'TERMINATE'; readonly evidenceDigest: string; readonly reason: string; readonly policyVersion: string };
      const resolution = await options.service.resolve({
        principal,
        originalExecutorRef: submit.originalExecutorRef,
        semanticActionId: submit.semanticActionId,
        decision: submit.decision,
        evidenceDigest: submit.evidenceDigest,
        reason: submit.reason,
        policyVersion: submit.policyVersion
      });
      const claim = await options.ledger.getClaim?.({ tenantId: principal.tenantId, semanticActionId: submit.semanticActionId });
      const taskId = claim?.taskId;
      let actionState: 'ACCEPTED' | 'COMPLETED' = 'ACCEPTED';
      if (options.taskControl !== undefined && taskId !== undefined && submit.action === 'CONTINUE_NEW_ATTEMPT' && submit.decision !== 'ABANDONED') {
        // 「未提交 + 继续」：新 attempt（新 Spec/attempt 经既有 retry 链路）；「已提交 + 继续」：retry 放行后由 Ledger replay 幂等防重复副作用。
        await options.taskControl.retry(taskId);
        actionState = 'COMPLETED';
      } else if (options.taskControl !== undefined && taskId !== undefined && submit.action === 'TERMINATE') {
        await options.taskControl.cancel(taskId);
        actionState = 'COMPLETED';
      }
      const outcome: ApiEffectResolutionOutcome = {
        schemaVersion: 'EffectResolutionResult.v1',
        status: resolution.status,
        resolutionRef: resolution.resolution.resolutionRef,
        decision: resolution.resolution.decision,
        action: submit.action,
        actionState,
        ...(taskId === undefined ? {} : { taskId })
      };
      return reply.code(resolution.status === 'existing' ? 200 : 201).send(outcome);
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : 'EFFECT_RESOLUTION_DENIED';
      const status = code === 'EFFECT_RESOLUTION_DENIED' || code === 'APPROVER_SEPARATION_REQUIRED' ? 403 : code.includes('CONFLICT') || code === 'EFFECT_NOT_UNKNOWN' ? 409 : 400;
      return sendError(reply, status, code);
    }
  });
}
