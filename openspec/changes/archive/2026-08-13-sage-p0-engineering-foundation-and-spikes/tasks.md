## 1. Workspace and quality baseline

- [x] 1.1 Create the `platform/` pnpm workspace, TypeScript base configuration, exact package versions, and committed lockfile.
- [x] 1.2 Add repeatable install, typecheck, test, build, lint, and dependency-boundary commands for a clean environment.
- [x] 1.3 Define package ownership and enforce that `agent-lib` cannot import application, Temporal, Fastify, database, or UI packages.

## 2. Local runtime profile

- [x] 2.1 Add a Compose development profile for PostgreSQL, Temporal dev, and an S3-compatible Artifact Store with health checks.
- [x] 2.2 Define Registry, Secret Manager, OIDC, and Artifact Adapter interfaces plus local fakes and contract-test scaffolding.
- [x] 2.3 Document bootstrap, health verification, teardown, and common local failure recovery.

## 3. Pi and Temporal spikes

- [x] 3.1 Lock Node.js, pnpm, TypeScript, Pi, and Temporal SDK candidates and record licensing/distribution evaluation.
- [x] 3.2 Implement and run the Pi capability Spike for Skill, Event, Session, cancellation, checkpoint, and resume behavior.
- [x] 3.3 Implement and run the Temporal Spike for Workflow bundle, deterministic replay, mTLS, Namespace, and Build ID behavior.
- [x] 3.4 Record reproducible commands, limitations, Adapter fallback points, and explicit P1/P4 block-or-proceed conclusions.

## 4. Phase gate

- [x] 4.1 Close or assign Owners for Registry, Secret, OIDC, Artifact, and initial environment-isolation decisions.
- [x] 4.2 Run clean-environment quality commands and local service health checks as P0 acceptance evidence.
- [x] 4.3 Publish P0 exit review confirming exact versions and Spike outcomes before authorizing P1/P4 work.