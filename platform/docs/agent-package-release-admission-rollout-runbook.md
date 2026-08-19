# Phase 3 Package/Registry/Admission rollout runbook

Status: `NO-GO` until all mandatory gates and named human approvals are present.

## Preconditions

1. Confirm the dependency gate and strict OpenSpec validation for the three authority changes and this Phase 3 change.
2. Run `check:deps`, `check:reference-workload`, package typechecks, conformance/replay suites, failure matrix, secret/endpoint/SQL/PII scanner, and PostgreSQL integration tests.
3. Confirm the Release owner, Admission owner, SRE/Operations owner, Security owner, and Architecture owner are named. Local fakes and shadow results are not production evidence.
4. Verify the immutable Release, lock, SBOM, provenance, signature, registry revision, policy revision, and compatibility build identities used by the canary.

## Ordered rollout

1. **Dark launch:** enable Package and Registry dark-launch flags only. Build and resolve releases without changing lifecycle ownership or issuing canonical admission.
2. **Shadow admission:** enable shadow admission for an allowlisted tenant and fixed TaskType. Compare only bounded semantic, route, and grant digests. Shadow must create no reservation, Spec, Envelope, dispatch, or public event.
3. **Convergence window:** observe the fixed minimum window and thresholds approved by the owners. Any semantic or authorization difference, dependency outage, sensitive telemetry finding, duplicate-owner signal, or budget anomaly stops the rollout and returns to `NO-GO`.
4. **Reference canary:** enable canonical new-workload entry only for the controlled-summary reference workload, one tenant, and one TaskType. Verify Interactive and Durable use the same immutable Release/Spec semantics.
5. **Legacy adapter cutover:** enable only after the reference canary and rollback drill pass. Existing Attempts retain their recorded lifecycle owner; new requests are selected at creation time.
6. **Expansion:** increase scope in bounded steps only after each observation window passes. Never infer a production GO from a local fake, an unreviewed metric, or an AI-generated review.

## Stop conditions

Set the kill switch, stop new canonical admission, and preserve legacy default on any mandatory gate failure, missing dependency, stale evidence, target/model unavailability, semantic diff, `EFFECT_UNKNOWN`, duplicate owner, reservation conflict, or telemetry boundary violation. Record the reason code and evidence references.

## Evidence

Every step records the command, source/build digest, registry/policy revision, allowlist, observation window, bounded metrics, audit reference, and named approver. Production remains `NO-GO` until all required external dependencies and human approvals are explicitly recorded.
