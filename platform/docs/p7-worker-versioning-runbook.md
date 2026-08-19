# P7 Temporal Worker Compatibility and Long-Workflow Runbook

This is an executable engineering procedure. Production namespace, release owner and change approvers remain **UNFILLED — HUMAN INPUT REQUIRED**.

## Version contract

1. Build identity is immutable: `sage-worker/<release-semver>/<workflow-bundle-sha256>`. Never reuse an identity for different Workflow code.
2. A release manifest records Node, Temporal SDK, Workflow bundle digest, Activity code digest and compatible predecessor IDs.
3. Workflow changes use Temporal deterministic APIs only. Before changing command order, Timer/Activity/Signal shape or branching, add a stable `patched("change-id")`/version marker and preserve the old branch until all pre-marker histories are closed or migrated explicitly.
4. Replay a bounded, sanitized corpus of open/long Workflow histories against the candidate bundle. Any nondeterminism is an immediate stop.
5. Activity input/output and persisted checkpoint/reference schemas are backward compatible for at least the complete rollout and rollback window. Credential values are never in the manifest or History.

> The pinned SDK supports `workerDeploymentOptions` and the local Temporal 1.29 exercise uses deployment-based Worker Versioning with `AUTO_UPGRADE`. These APIs are still marked experimental by the pinned CLI/SDK. Production must validate the exact server/SDK pair, namespace permissions and rollback policy before approval; this document does not turn the local choice into a production decision.

## Executable Worker Deployment commands

Workers must start with `workerDeploymentOptions.version={deploymentName,buildId}`, `useWorkerVersioning=true`, and an explicitly reviewed default behavior (`AUTO_UPGRADE` for the controlled exercise). After both versions register and poll every expected queue:

```bash
# Address, namespace, deployment and immutable Build IDs come from the approved release manifest.
temporal worker deployment describe --address "$TEMPORAL_ADDRESS" --namespace "$TEMPORAL_NAMESPACE" --name "$DEPLOYMENT"
temporal worker deployment set-ramping-version --address "$TEMPORAL_ADDRESS" --namespace "$TEMPORAL_NAMESPACE" \
  --deployment-name "$DEPLOYMENT" --build-id "$CANDIDATE_BUILD_ID" --percentage 5 --yes
# Repeat only after each approved soak gate: 25, 50, then promote current.
temporal worker deployment set-current-version --address "$TEMPORAL_ADDRESS" --namespace "$TEMPORAL_NAMESPACE" \
  --deployment-name "$DEPLOYMENT" --build-id "$CANDIDATE_BUILD_ID" --yes
# Rollback selects the immutable predecessor; do not rebuild/reuse its Build ID.
temporal worker deployment set-current-version --address "$TEMPORAL_ADDRESS" --namespace "$TEMPORAL_NAMESPACE" \
  --deployment-name "$DEPLOYMENT" --build-id "$PREDECESSOR_BUILD_ID" --yes
```

Never use `--allow-no-pollers` or `--ignore-missing-task-queues` for a production rollout. The local exercise uses an unversioned cleanup override only to restore its shared disposable queue after assertions.

## Controlled rollout

1. **Preflight:** frozen install, `pnpm check`, current/candidate replay, backup checks, queue/backlog baseline and external change record.
2. Start candidate workers at 0%/inactive compatibility routing. Confirm registration, health, namespace, queue and least-privilege credential ref.
3. Ramp compatible traffic 5% → 25% → 50% → 100%. At each step observe schedule-to-start, Activity retry, `effect_unknown`, projection drift and failure alerts for an approved soak duration (**UNFILLED — HUMAN INPUT REQUIRED**).
4. Keep predecessor workers and artifacts available throughout the approved rollback window (**UNFILLED — HUMAN INPUT REQUIRED**).
5. Do not move an already-started Workflow to another Cluster. Worker version routing stays inside its fixed target snapshot.

## Rollback

1. Stop the ramp; route compatible tasks back to the predecessor Build ID/deployment version.
2. Keep candidate code available for Workflows pinned to it unless replay proves predecessor compatibility.
3. Replay affected histories with the predecessor bundle. If replay is invalid, do not force rollback; isolate candidate workers and escalate.
4. Verify no duplicate durable effect keys, no increase in `effect_unknown`, and terminal History/projection agreement.
5. Record versions, timestamps, queue, Workflow IDs, replay result and external operator/change identity.

## Automated evidence

`examples/p4-integration/src/p4.integration.test.ts` contains `P7 rolls a long Workflow...`: two real deployment-versioned Workers register immutable digest-bearing v1/v2 Build IDs, the test executes Temporal CLI `set-current-version` v1→v2→v1 on a running three-slice Workflow, verifies each slice ran on the intended version with exactly three durable effects, inspects deployment state, replays final History, and restores the disposable shared queue to unversioned routing. `pnpm test:p7:exercises` records its result. This local dev exercise does not establish production compatibility or approve a release.

## Durable Coordinator rollout/drain/rollback gate

The following fields are mandatory inputs to the production change record; placeholders are intentional and keep the decision **NO-GO** until completed by accountable humans:

| Gate | Required production value | Current status |
|---|---|---|
| Supported replay window | Start/end build lines and maximum open-workflow age | **UNFILLED — HUMAN INPUT REQUIRED** |
| History sample retention | Sample rate, tenant scope, retention duration and access owner | **UNFILLED — HUMAN INPUT REQUIRED** |
| Release/change approver | Named human Release Owner and independent approver | **UNFILLED — HUMAN INPUT REQUIRED** |
| Worker/queue owner | Named human Operations/SRE owner and escalation roster | **UNFILLED — HUMAN INPUT REQUIRED** |
| Shadow/soak threshold | Replay pass 100%; nondeterminism 0; duplicate durable effects 0; `EFFECT_UNKNOWN` increase 0; projection drift and queue/start/error thresholds | **UNFILLED — HUMAN INPUT REQUIRED** |
| Rollback window | Duration during which predecessor build, replay corpus and artifacts remain available | **UNFILLED — HUMAN INPUT REQUIRED** |

### Drain procedure

1. Freeze new compatible-build admission and record the immutable policy/attestation digest.
2. Stop ramping and allow in-flight Activities to reach a terminal receipt or an explicitly bounded retry state; do not cancel or migrate an already-started Workflow merely to drain a queue.
3. Confirm queue pollers for the candidate are zero only after the drain observation window is approved; preserve the predecessor poller and all immutable Build IDs.
4. Reconcile bounded receipts, `EFFECT_UNKNOWN`, stale deliveries, History replay status and projection freshness. Any unresolved item blocks rollback completion and keeps **NO-GO**.

### Rollback procedure

1. Select the immutable predecessor Build ID from the approved release manifest; never rebuild or reuse a Build ID.
2. Disable new V2 admission before changing the current queue/deployment version. Active and unknown-start V2 Workflows retain their persisted owner and are not copied to legacy or another Cluster.
3. Replay every affected retained History against the predecessor and candidate bundles. Any missing History, unsupported replay window, nondeterminism, duplicate effect, owner conflict or threshold breach stops the rollback.
4. Observe the approved rollback window for queue lag, schedule-to-start, Activity retry, receipt conflict, `EFFECT_UNKNOWN`, projection drift and terminal History/projection agreement.
5. Record the operator, approver, build IDs, queue, deployment, timestamps, replay corpus digest, sampled History refs, metrics snapshot and final decision in append-only change evidence.

No local fake, AI review, or disposable Temporal exercise satisfies the production fields above. Until all values, evidence and human approvals are present, the production decision remains **NO-GO**.

## Phase 2 authority and rollback invariants

For every drain or rollback change record, capture the persisted Task path, owner token/state, target snapshot, adapter/runtime refs, start key and logical cursor. Temporal/Coordinator History and immutable receipt digests are the execution authority; PostgreSQL projection and API Task Card are read-only views with explicit freshness. Ledger/effect/usage stores remain authoritative for committed side effects and consumption; Artifact/Checkpoint stores remain authoritative for sealed/finalized references.

Rollback is admission control, not migration: disable new V2 admission before changing worker routing, leave active and `START_UNKNOWN` V2 Tasks on their original V2 owner, and leave legacy Tasks on legacy. Never copy or restart a Task on another path, target or Cluster. Any `EFFECT_UNKNOWN` state remains terminal/manual-blocked because this phase has no automated resolution protocol; stop all automatic retry/fallback and escalate with immutable evidence.
