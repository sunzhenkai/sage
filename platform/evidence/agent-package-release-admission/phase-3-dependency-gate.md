# Phase 3 dependency gate evidence

## 1.1 Apply dependency gate

The three required predecessor changes were checked from the delivery worktree:

```text
openspec validate agent-platform-contract-authority-foundation --strict
Change 'agent-platform-contract-authority-foundation' is valid

openspec validate agent-runtime-kernel-broker-integration --strict
Change 'agent-runtime-kernel-broker-integration' is valid

openspec validate durable-agent-coordinator-adapter --strict
Change 'durable-agent-coordinator-adapter' is valid
```

Each predecessor `tasks.md` has no unchecked task checkbox. The canonical contract/conformance gate was rerun with:

```text
corepack pnpm vitest run \
  packages/agent-runtime-conformance/src/index.test.ts \
  packages/harness-pi/src/index.test.ts \
  compatibility.integration.test.ts \
  apps/agent-api/src/chat-compatibility.test.ts \
  apps/agent-worker/src/task-compatibility.test.ts \
  packages/local-fakes/src/index.test.ts \
  packages/tool-runtime/src/index.test.ts \
  packages/agent-client/src/index.test.ts \
  packages/agent-lib/src/index.test.ts \
  packages/platform-ports/src/index.test.ts \
  packages/agent-contracts/src/index.test.ts

Test Files  11 passed (11)
Tests       131 passed (131)
```

Actual canonical package/port versions in the workspace are:

| Contract/port | Package | Version |
|---|---|---:|
| `AgentTaskSpec.v1`, `AgentExecutionEnvelope.v1` | `@sage/agent-contracts` | `1.0.0` |
| `AgentTaskSpecStorePort`, `DurableCoordinatorPort`, Broker-facing ports | `@sage/platform-ports` | `0.1.0` |
| framework-neutral Engine/conformance factory | `@sage/agent-runtime-conformance` | `0.1.0` |
| canonical runtime library | `@sage/agent-lib` | `0.1.0` |
| client/legacy adapters | `@sage/agent-client` | `0.1.0` |
| trusted routing port/adapter | `@sage/temporal-routing` | `0.1.0` |

The source confirms `AgentTaskSpecSchema` and `AgentExecutionEnvelopeSchema` are versioned v1 contracts in `packages/agent-contracts/src/index.ts`; `AgentTaskSpecStorePort` and `DurableCoordinatorPort` are exposed from `packages/platform-ports/src/index.ts`. The conformance suite is framework-neutral and uses deterministic/local fakes; it is engineering evidence only.

This gate does not claim production readiness. Production Temporal/PostgreSQL/Artifact/Secret/KMS/provider dependencies, replay/retention windows, named production Owners/approvers, approved SLO/RTO/RPO, and human GO approval remain external gates. Production admission therefore remains **NO-GO**.

## 1.2 Evidence — canonical contract/port alignment and boundary scan

The Phase 3 design was checked against the frozen predecessor surfaces. `@sage/agent-contracts@1.0.0` remains the owner of `AgentTaskSpec.v1` and `AgentExecutionEnvelope.v1`; `@sage/platform-ports@0.1.0` remains the owner of `AgentTaskSpecStorePort`, `DurableCoordinatorPort`, Broker-facing ports, and related persistence/receipt interfaces. The Phase 3 change does not redefine those contracts or create a second lifecycle authority.

The canonical source packages were scanned for Temporal, Provider, Web/DOM, database-driver, and MCP SDK imports/tokens, and the Phase 3 package roots were checked before package-skeleton task 1.3:

```text
node scripts/check-dependencies.mjs
Dependency boundaries: OK
Phase 3 canonical alignment: PASS
No Phase 3 package implementation exists before package-skeleton task 1.3; no duplicate authority or SDK surface found.
```

The first scan was rejected as a false positive because an unbounded `BuildId` pattern matched the legitimate `AgentBuildIdentity` symbol. The final scan uses token boundaries and passed without source changes. This is a local static alignment gate; it does not establish production provider, credential, registry, Ledger, or readiness evidence. Production remains **NO-GO**.

## 1.3 Evidence — package skeleton, ownership, and workspace integration

Created the three Phase 3 logical package roots without moving execution authority:

- `platform/packages/agent-package-release`: declaration/compiler owner;
- `platform/packages/agent-release-registry`: immutable release metadata/channel-pointer owner;
- `platform/packages/agent-run-admission`: admission compiler owner that imports, rather than redefines, `AgentTaskSpec`, `AgentExecutionEnvelope`, `AgentTaskSpecStorePort`, and `DurableCoordinatorPort`.

Updated `platform/package-ownership.json` with explicit owners and allowed dependencies, and updated `platform/tsconfig.json` project references. Each package has a private ESM `package.json`, `src/index.ts`, smoke test, and `tsconfig.json`; no Temporal, Provider, Web, database-driver, or MCP SDK dependency was introduced.

After an offline workspace-link install (`corepack pnpm install --offline --ignore-scripts --lockfile=false`), the final validation passed:

```text
@sage/agent-package-release typecheck: PASS
@sage/agent-release-registry typecheck: PASS
@sage/agent-run-admission typecheck: PASS
@sage/agent-package-release test: 1 passed
@sage/agent-release-registry test: 1 passed
@sage/agent-run-admission test: 1 passed
@sage/agent-package-release build: PASS
@sage/agent-release-registry build: PASS
@sage/agent-run-admission build: PASS
node scripts/check-dependencies.mjs
Dependency boundaries: OK
```

This is package/boundary engineering evidence only. It does not establish production registry, identity, credential, provider, billing, or readiness evidence; production remains **NO-GO**.

## 1.4 Evidence — cross-package dependency boundary

Extended `platform/scripts/check-dependencies.test.ts` with Phase 3 negative cases and added hard constraints for all three new package roots in `platform/package-ownership.json`. The matrix rejects unauthorized `@sage/*` dependencies and direct Temporal, Provider, HTTP/Web, database-driver, and MCP SDK imports, plus framework-shaped serialized fields.

Validation after fixing one test-fixture policy omission (`workflowId` was not included in the shared Phase 3 negative-key list):

```text
corepack pnpm vitest run scripts/check-dependencies.test.ts
1 test file passed
32 tests passed

node scripts/check-dependencies.mjs
Dependency boundaries: OK

@sage/agent-package-release typecheck: PASS
@sage/agent-release-registry typecheck: PASS
@sage/agent-run-admission typecheck: PASS
```

The scanner protects package ownership and public dependency direction; it does not claim provider, credential, registry, billing, or production readiness evidence. Production remains **NO-GO**.

## 2.1 Evidence — bounded AgentPackage.v1 schema and canonical serializer

Implemented the explicit-major `AgentPackage.v1` reader and canonical serializer in `platform/packages/agent-package-release/src/index.ts`. The reader rejects unsupported major versions and unknown top-level fields, detects duplicate object keys before JSON parsing can discard them, and enforces bounded package bytes, nesting depth, identifier/key length, string length, array length, and finite numeric values. The serializer recursively sorts object keys and applies NFC Unicode normalization before emitting canonical JSON.

Added executable tests for version and unknown-field rejection, duplicate keys, bounded identifiers/strings/arrays/bytes, sorted keys, and stable Unicode normalization. Validation:

```text
corepack pnpm --filter @sage/agent-package-release typecheck
PASS

corepack pnpm --filter @sage/agent-package-release test
1 test file passed
5 tests passed

corepack pnpm --filter @sage/agent-package-release build
PASS

node scripts/check-dependencies.mjs
Dependency boundaries: OK
```

This task establishes a bounded schema/serialization foundation only; business-field allowlists and the full forbidden-content/property matrix remain tasks 2.2 and 2.4. It does not claim production registry, provider, credential, object-store, billing, replay/retention, Owner, RTO/RPO, `EFFECT_UNKNOWN` resolution, or human GO evidence. Production remains **NO-GO**.

## 2.2 Evidence — declaration category field allowlists

Extended the strict `AgentPackage.v1` reader with explicit nested field allowlists for metadata, agent definition, Skills, Capabilities, Context, Model requirements, schemas, Policies, Budgets, eval cases, plan hints, and View metadata. Unknown fields inside these categories fail closed with a stable `PACKAGE_UNKNOWN_FIELD:<section>.<field>` error; bounded declaration maps remain non-executable data and are still subject to the 2.1 size/depth limits.

Added a negative test proving an unapproved `agent.executable` field is rejected, while the declaration-only fixture covering the supported categories remains accepted. Validation:

```text
corepack pnpm --filter @sage/agent-package-release typecheck
PASS

corepack pnpm --filter @sage/agent-package-release test
1 test file passed
6 tests passed

corepack pnpm --filter @sage/agent-package-release build
PASS

node scripts/check-dependencies.mjs
Dependency boundaries: OK
```

This task covers ordinary declaration-field allowlisting only. Native/WASM/script, remote-include, credential, endpoint, SQL/MQL, and SDK-content rejection remain task 2.3; the complete schema/serializer property and forbidden-content matrix remains task 2.4. No production provider, registry, credential, replay/retention, Owner, RTO/RPO, `EFFECT_UNKNOWN` resolution, or human GO evidence is claimed. Production remains **NO-GO**.

## 2.3 Evidence — forbidden-content static scan

Added a pure-data static scanner to the `AgentPackage.v1` reader. It recursively inspects bounded keys and string values without loading, evaluating, or executing package content, and rejects dynamic/native-shaped material, WASM/script/module/include forms, remote or physical locations, credential-like material, database/table identifiers, SQL/MQL-shaped text, custom frontend markup, and infrastructure SDK-shaped fields with stable `PACKAGE_FORBIDDEN_CONTENT` errors. The scan runs before the parsed package can enter later compiler stages, so rejected content cannot produce a Release.

Added negative coverage for a remote URI, query-shaped text, dynamic module expression, a physical queue-location key, and frontend script markup. Validation:

```text
corepack pnpm --filter @sage/agent-package-release typecheck
PASS

corepack pnpm --filter @sage/agent-package-release test
1 test file passed
7 tests passed

corepack pnpm --filter @sage/agent-package-release build
PASS

node scripts/check-dependencies.mjs
Dependency boundaries: OK
```

The scanner is local compiler engineering evidence; it is not production supply-chain, provider, credential, object-store, billing, replay/retention, Owner, RTO/RPO, `EFFECT_UNKNOWN` resolution, or human GO evidence. Production remains **NO-GO**.

## 2.4 Evidence — schema/serializer and forbidden-content test matrix

Expanded the package-release test suite with boundary and property-style cases for unknown fields, nested duplicate keys, explicit major versions, bounded depth/bytes/strings/arrays/identifiers, Unicode NFC normalization, canonical key ordering, top-level permutation invariance, and the forbidden-content pattern matrix. Tests also assert that rejected text is only inspected as data and cannot execute or produce a package result.

Final validation:

```text
corepack pnpm --filter @sage/agent-package-release typecheck
PASS

corepack pnpm --filter @sage/agent-package-release test
1 test file passed
10 tests passed

corepack pnpm --filter @sage/agent-package-release build
PASS

node scripts/check-dependencies.mjs
Dependency boundaries: OK
```

The completed suite is local schema/compiler evidence. It does not replace production supply-chain verification, provider/credential/object-store/registry/billing dependencies, replay/retention windows, named Owners, RTO/RPO, `EFFECT_UNKNOWN` resolution, or human GO approval. Production remains **NO-GO**.

## 3.1 Evidence — trusted artifact/catalog resolution ports

Extended canonical `@sage/platform-ports` with framework-neutral `TrustedArtifactCatalogPort`, `TrustedPackageDependencyRequest`, `TrustedPackageDependencyIdentity`, and the versioned dependency-kind union covering Engine compatibility, Skill, Context, Capability, Tool, Model, Policy, schema, and Budget identities. `agent-package-release` now consumes this port through a bounded resolver that requires a matching catalog revision, exact dependency kind, non-empty artifact/version identities, and a SHA-256 digest; unresolved or mismatched results fail closed as `DEPENDENCY_UNRESOLVED`.

Updated package ownership, package dependencies, and TypeScript project references to preserve the canonical dependency direction. Added a local conformance smoke test covering all nine dependency kinds and an unresolved-result rejection. Validation:

```text
corepack pnpm --filter @sage/platform-ports typecheck
PASS

corepack pnpm --filter @sage/platform-ports build
PASS

corepack pnpm --filter @sage/agent-package-release typecheck
PASS

corepack pnpm --filter @sage/agent-package-release test
1 test file passed
11 tests passed

corepack pnpm --filter @sage/agent-package-release build
PASS

node scripts/check-dependencies.mjs
Dependency boundaries: OK
```

The catalog implementation used for the test is a local deterministic fake and is not production catalog/provider evidence. Alias/latest rejection, revocation/trust policy, supply-chain attestations, and production dependency readiness remain later tasks and external gates. Production remains **NO-GO**.

## 3.2 Evidence — stable trusted-dependency resolution gate

Hardened the trusted catalog resolver in `platform/packages/agent-package-release/src/index.ts` and the canonical types in `platform/packages/platform-ports/src/index.ts`. The resolver now rejects unstable selectors before calling the catalog, including `latest`, `stable`, `current`, `default`, wildcard selectors, and floating semver expressions. It also rejects unstable resolved artifact refs/versions, ambiguous catalog matches (`matchCount !== 1`), explicitly revoked identities, and explicitly untrusted identities. The stable error taxonomy is `DEPENDENCY_SELECTOR_INVALID`, `DEPENDENCY_AMBIGUOUS`, `DEPENDENCY_REVOKED`, `DEPENDENCY_UNTRUSTED`, and `DEPENDENCY_UNRESOLVED`.

The port identity now carries optional trusted-catalog status fields (`trustStatus`, `revocationStatus`, `matchCount`) without importing a concrete registry, provider SDK, or runtime target. Tests cover all nine dependency kinds with exact versions, pre-catalog rejection of latest/floating aliases, ambiguous results, revoked results, untrusted results, unstable resolved identities, and unresolved dependencies. The resolver remains bounded and preserves catalog revision, dependency-kind, SHA-256 digest, and non-empty artifact/version checks from task 3.1.

Final validation:

```text
corepack pnpm@10.33.0 --filter @sage/platform-ports typecheck
PASS

corepack pnpm@10.33.0 --filter @sage/platform-ports build
PASS

corepack pnpm@10.33.0 --filter @sage/agent-package-release typecheck
PASS

corepack pnpm@10.33.0 --filter @sage/agent-package-release test
1 test file passed
15 tests passed

corepack pnpm@10.33.0 --filter @sage/agent-package-release build
PASS

node scripts/check-dependencies.mjs
Dependency boundaries: OK
```

The resolver tests use a local deterministic fake catalog only; that fake is not production registry, trust-root, revocation, provider, credential, object-store, billing, replay/retention, Owner, RTO/RPO, `EFFECT_UNKNOWN` resolution, or human GO evidence. Production admission remains **NO-GO**.

## 3.3 Evidence — canonical AgentPackageLock.v1

Implemented `AgentPackageLock.v1` in `platform/packages/agent-package-release/src/index.ts`. `buildAgentPackageLockV1` binds the package identity/version, source SHA-256 digest, compiler build, resolver build, every catalog revision, and every exact dependency artifact reference/version/digest. It projects trusted catalog identities into a lock-safe dependency shape, rejects invalid or mutable digest/version inputs, rejects duplicate dependencies and missing catalog revisions, and defensively rejects ambiguous, revoked, or untrusted identities. Dependencies and catalog revisions are deterministically sorted; `serializeAgentPackageLockV1` emits canonical JSON and rejects a non-v1 lock schema.

The lock does not carry principal identity, Secret bytes, physical runtime target, live grant, or remaining budget. It records exact artifact identities and catalog revisions for replay/build provenance without adding a concrete registry, provider SDK, or execution authority.

Validation:

```text
corepack pnpm@10.33.0 --filter @sage/agent-package-release typecheck
PASS

corepack pnpm@10.33.0 --filter @sage/agent-package-release test
1 test file passed
17 tests passed

corepack pnpm@10.33.0 --filter @sage/agent-package-release build
PASS

node scripts/check-dependencies.mjs
Dependency boundaries: OK
```

Tests cover canonical ordering and byte-stable serialization across dependency/catalog permutations, all nine dependency kinds, source/artifact digest validation, missing catalog revisions, duplicate dependencies, unstable versions, schema major rejection, and trust/revocation/ambiguity defenses. This is local compiler/serializer evidence only; it does not establish production registry, trust-root, provider, credential, object-store, billing, replay/retention, named Owner, RTO/RPO, `EFFECT_UNKNOWN` resolution, or human GO evidence. Production remains **NO-GO**.

## 3.4 Evidence — canonical hashing and reproducible build inputs

Added canonical SHA-256 hashing for serialized `AgentPackage.v1`, `AgentPackageLock.v1`, and the combined package/lock content. The implementation hashes the exact canonical UTF-8 JSON emitted by the bounded serializers, preserving sorted keys, NFC normalization, deterministic dependency/catalog ordering, and the lock binding to `sourceDigest`. `computeAgentPackageBuildDigests` returns source, lock, and content digests and fails closed when a lock is paired with a different package source.

The reproducibility matrix repeats the same package, compiler build, resolver build, catalog revision, and exact dependency identity and obtains byte-equivalent lock JSON plus identical digests. It then mutates compiler build and package source independently and asserts new lock/content or source/content digests; a source/lock mismatch is rejected rather than producing a partial build.

Validation:

```text
corepack pnpm@10.33.0 --filter @sage/agent-package-release typecheck
PASS

corepack pnpm@10.33.0 --filter @sage/agent-package-release test
1 test file passed
18 tests passed

corepack pnpm@10.33.0 --filter @sage/agent-package-release build
PASS

node scripts/check-dependencies.mjs
Dependency boundaries: OK
```

Hashing and reproducibility are local compiler evidence. They do not establish production registry, trust issuer/KMS, provider, credential, object-store, billing, replay/retention, named Owner, RTO/RPO, `EFFECT_UNKNOWN` resolution, or human GO evidence. Production remains **NO-GO**.

## 3.5 Evidence — SBOM, provenance and digest-covered signature fixture

Implemented bounded supply-chain evidence generation and verification in `agent-package-release`. The generated Package dependency SBOM contains the package source digest, lock digest, and every exact locked artifact reference/version/digest/catalog revision. Source/build provenance binds source digest, lock digest, compiler build, resolver build, catalog revisions, and SBOM digest. The deterministic signature payload covers content digest, lock digest, SBOM digest, provenance digest, and compiler build; its resulting `signatureDigest` is verified against the canonical payload.

`validateAgentPackageSupplyChainEvidenceV1` rebuilds the expected evidence from the Package and lock and rejects schema changes, content-digest mutation, provenance mutation, and other attestation mismatches before any later Release use. Issuer/key trust, expiry, revocation, license/vulnerability policy, and production signature verification remain task 3.6 gates rather than being implied by this local deterministic fixture.

Validation:

```text
corepack pnpm@10.33.0 --filter @sage/agent-package-release typecheck
PASS

corepack pnpm@10.33.0 --filter @sage/agent-package-release test
1 test file passed
19 tests passed

corepack pnpm@10.33.0 --filter @sage/agent-package-release build
PASS

node scripts/check-dependencies.mjs
Dependency boundaries: OK
```

The evidence builder and tests are local compiler/supply-chain-shape evidence; they do not establish a production issuer, key service, registry, provider, credential, object-store, billing, replay/retention, named Owner, RTO/RPO, `EFFECT_UNKNOWN` resolution, or human GO approval. Production remains **NO-GO**.

## 3.6 Evidence — trust, expiry/revocation, policy and attestation gates

Extended supply-chain evidence with explicit issuer/key references, issued/expiry timestamps, revocation status, license/vulnerability policy evidence and `trustRootClass`. The default deterministic fixture is deliberately marked `issuer://LOCAL_TEST_ONLY_UNTRUSTED`, `key://LOCAL_TEST_ONLY_KEY`, and `NON_PRODUCTION_TEST`; it is not a production trust root.

Implemented `verifyAgentPackageSupplyChainTrustV1`, which first rebuilds canonical SBOM/provenance/policy/signature evidence and rejects attestation mismatch, then fail-closes on issuer or key not in the supplied trusted allowlists, non-production trust roots without an explicit test-only switch, revoked or expired attestations, invalid time windows, license policy failure, and vulnerability policy failure. No concrete KMS, signing service, registry, provider SDK, or production credential was introduced.

Validation:

```text
corepack pnpm@10.33.0 --filter @sage/agent-package-release typecheck
PASS

corepack pnpm@10.33.0 --filter @sage/agent-package-release test
1 test file passed
20 tests passed

corepack pnpm@10.33.0 --filter @sage/agent-package-release build
PASS

node scripts/check-dependencies.mjs
Dependency boundaries: OK
```

Tests cover acceptance only with an explicit local-test policy, non-production trust-root rejection, issuer/key rejection, expiry, revocation, license denial, vulnerability denial, and attestation mutation. These are local deterministic gate tests; they do not establish production issuer/key, KMS, registry, provider, credential, object-store, billing, replay/retention, named Owner, RTO/RPO, `EFFECT_UNKNOWN` resolution, or human GO approval. Production remains **NO-GO**.


## 3.7 AgentPackageRelease create-only schema/builder evidence

- Implementation: `platform/packages/agent-package-release/src/index.ts` adds `AgentPackageReleaseV1`, `AgentPackageReleaseInput`, `buildAgentPackageReleaseV1`, `serializeAgentPackageReleaseV1`, and `isAgentPackageReleaseV1`; `platform/packages/agent-contracts/src/index.ts` now carries the matching strict `AgentPackageRelease.v1` schema with `additionalProperties: false`.
- The builder binds package/source digest, canonical lock digest, owner reference, kernel contract major, sorted Engine IDs and exact Engine-compatibility dependency digests, all locked dependency digests, compiler reference/digest/build, SBOM/provenance/policy/signature digests, signature refs, and attestation refs.
- Release identity is content-addressed from the canonical release payload excluding `releaseRef` and `releaseId`; the generated ref is `release://<release-id>`. Serializer read-back rejects owner, compatibility, dependency, provenance, attestation, or compiler mutation with `RELEASE_IDENTITY_MISMATCH` or a stable field error.
- The strict release surface contains no caller principal/role/identity, Secret bytes, physical runtime target, live capability grant, or remaining budget. Unknown fields and forbidden runtime-authority field names are rejected before serialization.
- `buildAgentPackageReleaseV1` revalidates canonical supply-chain evidence and lock/source/content linkage, rejects compiler-build or Engine-compatibility mismatches, and requires trusted/validated evidence refs without embedding executable artifact bytes.
- Validation evidence: `corepack pnpm@10.33.0 --filter @sage/agent-package-release typecheck` PASS; `... test` PASS with **21 tests**; `... build` PASS. `corepack pnpm@10.33.0 --filter @sage/agent-contracts typecheck` PASS; `... build` PASS; direct `vitest run packages/agent-contracts/src/index.test.ts` PASS with **12 tests**. `node scripts/check-dependencies.mjs` reported `Dependency boundaries: OK`; `git diff --check` PASS.
- Tests cover deterministic content-addressed release construction, owner/lock/content/dependency/Engine/attestation/compiler bindings, identity mutation rejection, and rejection of `target` and `remainingBudget` fields. Canonical contract tests also reject incompatible schema versions and extra executable configuration.
- This evidence is local deterministic engineering evidence only. The local trust-root/signature fixtures remain explicitly `NON_PRODUCTION_TEST`; no local fake is a production provider, Registry, object store, KMS, policy authority, or readiness proof. Production remains **NO-GO** pending named owners, real production dependencies, replay/retention window, RTO/RPO, `EFFECT_UNKNOWN` resolution evidence, and human GO approval.


## 3.8 Release construction and negative-test evidence

- Added tests for deterministic Release construction, content/digest mutation rejection, invalid attestation mismatch, revoked attestation rejection, and independent Engine, Provider-adapter, and Capability artifact references carried by the canonical lock.
- Invalid signature evidence fails during Release build with `SUPPLY_CHAIN_ATTESTATION_MISMATCH`; revoked evidence fails during Release build with `RELEASE_ATTESTATION_REVOKED` and during trust verification with `SUPPLY_CHAIN_ATTESTATION_REVOKED`.
- The fixture keeps exact independent refs in the lock (`artifact://engine/reference/1.0.0`, `artifact://provider/provider-a/adapter-1.0.0`, `artifact://capability/document-read/1.0.0`) and proves the resulting Release retains all corresponding dependency digests without collapsing them into one logical artifact.
- Mutating `contentDigest` after construction is rejected by the create-only serializer with `RELEASE_IDENTITY_MISMATCH`; the prior owner/target/remaining-budget mutation cases remain covered.
- Validation evidence: `corepack pnpm@10.33.0 --filter @sage/agent-package-release typecheck` PASS; `... test` PASS with **22 tests**; `... build` PASS. `@sage/agent-contracts` typecheck/build PASS and direct contract suite PASS with **12 tests**. `node scripts/check-dependencies.mjs` reported `Dependency boundaries: OK`; `git diff --check` PASS.
- These are deterministic local unit/schema and boundary results, not production provider, Registry, KMS, revocation-service, or readiness evidence. Local trust fixtures remain `NON_PRODUCTION_TEST`, and production remains **NO-GO** pending named owners, real production dependencies, replay/retention window, RTO/RPO, `EFFECT_UNKNOWN` resolution evidence, and human GO approval.


## 4.1 Release Registry PostgreSQL migration evidence

- Added `platform/packages/agent-state-postgres/migrations/004_agent_package_release_registry.sql` and its owned rollback file. `PostgresAgentStateAdapter.migrate()` now executes 001 legacy state, 002 canonical authority, 003 runtime kernel/broker, then 004 Release Registry in order.
- The additive schema defines tenant-scoped `agent_package_releases` with release/content/lock digests, immutable payload and lock JSON, attestation refs, owner namespace/package scope, create-only primary/unique keys, and JSON checks rejecting principal/secret/target/live-grant/remaining-budget fields.
- `agent_release_attestations` is tenant/release-bound and immutable with typed SBOM/provenance/signature/policy refs and digest checks. `agent_release_channels` separates mutable channel pointers and monotonic pointer revisions from immutable Release rows with composite tenant/owner/package foreign-key scope.
- `agent_release_audit` is append-only through a database trigger, ordered by generated audit ID, tenant/namespace bound, and constrained to submit/verify/publish/rollback/reject actions, non-empty reason, bounded actor/ref fields, and optional policy/signature/release digests. Release, attestation, and audit UPDATE/DELETE are fail-closed via `sage_agent_release_immutable_guard`.
- Validation evidence: direct `vitest run packages/agent-state-postgres/src/runtime-migration.test.ts` **4/4 passed**, covering forward transaction/checksum, immutable Registry authorities, owned rollback, and preservation of prior runtime authorities. `corepack pnpm@10.33.0 --filter @sage/agent-state-postgres typecheck` PASS; `build` PASS; `node scripts/check-dependencies.mjs` reported `Dependency boundaries: OK`; `git diff --check` PASS.
- A live PostgreSQL integration run was not represented as production evidence because the existing integration suite requires an explicitly configured `P2_POSTGRES_URL`; the static SQL/conformance suite does not prove a production database, HA, RLS deployment, or readiness state.
- Migration rollback is local/dev ownership evidence only and does not authorize destructive production rollback. Local fixtures and prior `NON_PRODUCTION_TEST` trust roots remain non-production. Production remains **NO-GO** pending named owners, real production dependencies, replay/retention window, RTO/RPO, `EFFECT_UNKNOWN` resolution evidence, and human GO approval.


## 4.2 Tenant-bound immutable Release Store and idempotent submit evidence

- Implemented `AgentReleaseStore` and `InMemoryAgentReleaseStore` in `platform/packages/agent-release-registry/src/index.ts`. The Store uses tenant-prefixed indexes for identity, content digest, and release ref; every read requires an explicit tenant, and returned records are detached clones.
- Submit validation is strict for the Release v1 shape, release/ref/digest relationships, package scope, lock payload object, attestation refs, compatibility arrays, and provenance linkage. Runtime authority fields are not accepted as part of the release record, and no provider/database SDK was introduced.
- Create-only behavior is covered: the first submit stores one immutable record; an identical retry returns `status: existing` and the original `releaseRef` without adding an audit entry; a same-identity payload/content/lock/attestation mutation fails with `RELEASE_IDENTITY_CONFLICT` and leaves the original record unchanged.
- Content-addressed replay is tenant-bound: an identical content digest in another tenant is independently stored, while an owner/package scope collision in one tenant fails with `RELEASE_CONTENT_SCOPE_CONFLICT`. Invalid input and release-ref collisions fail closed with bounded rejection audit records.
- Validation evidence:

```text
corepack pnpm@10.33.0 --filter @sage/agent-release-registry test
1 test file passed
6 tests passed

corepack pnpm@10.33.0 --filter @sage/agent-release-registry typecheck
PASS

corepack pnpm@10.33.0 --filter @sage/agent-release-registry build
PASS

node scripts/check-dependencies.mjs
Dependency boundaries: OK

git diff --check -- platform/packages/agent-release-registry/src/index.ts platform/packages/agent-release-registry/src/index.test.ts openspec/changes/agent-package-release-admission/tasks.md
PASS
```

This is local deterministic Store/contract evidence only; it is not PostgreSQL integration, production Registry, RLS, KMS, object-store, provider, credential, billing, replay/retention, named Owner, RTO/RPO, `EFFECT_UNKNOWN` resolution, or human GO evidence. Production remains **NO-GO**.


## 4.3 Release publication verifier evidence

- Added the pure `verifyReleasePublication` gate in `platform/packages/agent-release-registry/src/index.ts`. It requires an authenticated actor, the `release-publisher` role, owner-namespace scope, a bounded non-empty reason, and a non-negative `expectedRevision` equal to the observed channel revision.
- The verifier requires valid, non-revoked signature/provenance/SBOM checks whose digests exactly match the immutable Release provenance fields. It also checks kernel major and every engine compatibility digest against the supplied supported compatibility map.
- Policy publication is fail-closed unless the policy gate is allowed, its digest matches the Release policy digest, and both license and vulnerability statuses are `pass`. The result is a bounded projection containing refs/digests/revision and no full payload or credential material.
- The verifier is pure: it does not mutate Releases, channel pointers, or audit state; pointer CAS and transactional audit are intentionally deferred to task 4.4.
- Validation evidence:

```text
corepack pnpm@10.33.0 --filter @sage/agent-release-registry test
1 test file passed
11 tests passed

corepack pnpm@10.33.0 --filter @sage/agent-release-registry typecheck
PASS

corepack pnpm@10.33.0 --filter @sage/agent-release-registry build
PASS

node scripts/check-dependencies.mjs
Dependency boundaries: OK

git diff --check -- platform/packages/agent-release-registry/src/index.ts platform/packages/agent-release-registry/src/index.test.ts openspec/changes/agent-package-release-admission/tasks.md
PASS
```

Tests cover successful bounded verification, missing authentication, missing role, owner-scope denial, empty reason, revision conflict/invalidity, revoked or mismatched signature/provenance/SBOM, compatibility mismatch, and policy denial. This is local deterministic verifier evidence only; it does not establish production signer/KMS, policy authority, PostgreSQL/CAS transaction, provider, credential, replay/retention, named Owner, RTO/RPO, `EFFECT_UNKNOWN` resolution, or human GO evidence. Production remains **NO-GO**.


## 4.4 Channel pointer CAS and atomic audit evidence

- Extended `InMemoryAgentReleaseStore` with tenant/owner/package/channel-scoped `ReleaseChannelPointer` state and `publish()` CAS. The authoritative current revision is read from the Store; a request must match it in both `expectedRevision` and `currentRevision`, and a successful publish increments the pointer revision exactly once.
- Publish reuses the pure 4.3 publication verifier, confirms the submitted immutable Release is already stored in the same tenant/owner/package scope, and records an ordered append-only `publish` audit entry with channel, from/to ref, digest, actor-derived reason, and result.
- The pointer mutation and audit append are treated as one in-memory transaction. An injected `ReleaseAuditWriter` failure restores the prior pointer (or removes a newly created pointer), truncates any partial audit append, and preserves the immutable Release. A stale expected revision fails with `RELEASE_CHANNEL_CONFLICT`.
- Validation evidence:

```text
corepack pnpm@10.33.0 --filter @sage/agent-release-registry test
1 test file passed
14 tests passed

corepack pnpm@10.33.0 --filter @sage/agent-release-registry typecheck
PASS

corepack pnpm@10.33.0 --filter @sage/agent-release-registry build
PASS

node scripts/check-dependencies.mjs
Dependency boundaries: OK

git diff --check -- platform/packages/agent-release-registry/src/index.ts platform/packages/agent-release-registry/src/index.test.ts openspec/changes/agent-package-release-admission/tasks.md
PASS
```

Tests cover first publish, ordered audit, stale CAS conflict, cross-tenant channel isolation, audit failure rollback, and preservation of the submitted immutable Release. This is local deterministic transaction/reference-store evidence only; it does not establish PostgreSQL transaction isolation, production RLS, HA, KMS/signer, provider, credential, replay/retention, named Owner, RTO/RPO, `EFFECT_UNKNOWN` resolution, or human GO evidence. Production remains **NO-GO**.


## 4.5 Deterministic immutable/channel resolution evidence

- Added `resolveImmutableRelease` and `resolveChannelRelease` to the Release Store. Immutable resolution is tenant-prefixed and returns the stored Release without consulting channel state; channel resolution reads the tenant/owner/package/channel pointer and returns the pointed immutable ref, content digest, full Release, and pointer `observedRevision`.
- A channel update therefore cannot change an already pinned immutable ref. Missing tenant-scoped refs/channels fail with `RELEASE_NOT_FOUND`; a pointer to a missing or scope-mismatched Release fails with `RELEASE_INTEGRITY_FAILURE`. The API returns resolution data for Admission to snapshot; it does not provide a Host runtime alias re-resolution path.
- Validation evidence:

```text
corepack pnpm@10.33.0 --filter @sage/agent-release-registry test
1 test file passed
16 tests passed

corepack pnpm@10.33.0 --filter @sage/agent-release-registry typecheck
PASS

corepack pnpm@10.33.0 --filter @sage/agent-release-registry build
PASS

node scripts/check-dependencies.mjs
Dependency boundaries: OK

git diff --check -- platform/packages/agent-release-registry/src/index.ts platform/packages/agent-release-registry/src/index.test.ts openspec/changes/agent-package-release-admission/tasks.md
PASS
```

Tests cover immutable ref stability after a channel moves to a second Release, observed channel revision, and cross-tenant denial. This is local deterministic resolution/reference-store evidence only; it does not establish production PostgreSQL consistency, RLS, HA, provider, credential, replay/retention, named Owner, RTO/RPO, `EFFECT_UNKNOWN` resolution, or human GO evidence. Production remains **NO-GO**.


## 4.6 Controlled rollback to a verified predecessor evidence

- Added `rollback()` to the tenant-scoped Release Store. It reuses the same authenticated publication verifier, owner scope, bounded reason, attestation/provenance/SBOM, compatibility, policy, and authoritative channel CAS checks as `publish()`.
- Successful publish/rollback transitions append immutable pointer history. A rollback is accepted only when the target Release was previously successfully published on the same tenant/owner/package/channel and is not the current pointer; an unverified/unpublished target and a rollback to the current pointer fail closed with `RELEASE_ROLLBACK_PREDECESSOR_REQUIRED`.
- Rollback changes only the mutable channel pointer and adds a bounded `rollback` audit record with from/to refs, digest, reason, result, and monotonic revision. Existing immutable Release records are never copied or modified. If the audit writer fails, the pointer, predecessor history, and local audit append are restored atomically while both Releases remain available.
- Validation evidence:

```text
corepack pnpm@10.33.0 --filter @sage/agent-release-registry test
1 test file passed
18 tests passed

corepack pnpm@10.33.0 --filter @sage/agent-release-registry typecheck
PASS

corepack pnpm@10.33.0 --filter @sage/agent-release-registry build
PASS

node scripts/check-dependencies.mjs
Dependency boundaries: OK

git diff --check -- platform/packages/agent-release-registry/src/index.ts platform/packages/agent-release-registry/src/index.test.ts openspec/changes/agent-package-release-admission/tasks.md
PASS
```

Tests cover publish A → publish B → rollback A, immutable Release preservation, channel observed revision, current/unpublished rollback rejection, shared authentication/reason/CAS gates, and rollback audit failure atomicity. This is local deterministic reference-store evidence only; it is not PostgreSQL integration, production Registry/RLS/HA, real signer/KMS/provider/credential/object-store, replay/retention, named Owner, RTO/RPO, `EFFECT_UNKNOWN` resolution, or human GO evidence. Production remains **NO-GO**.


## 4.7 PostgreSQL Registry integration test evidence

- Added the gated integration contract in `platform/packages/agent-state-postgres/src/index.integration.test.ts`. When `P2_POSTGRES_URL` is configured it migrates the real PostgreSQL schema and exercises tenant-scoped Release/Channel rows, parameterized ACL lookups, concurrent pointer CAS, create-only Release/audit triggers, transaction rollback after audit failure, publish B → rollback A, and independent pre/post rollback `agent_task_specs` snapshots.
- The test uses unique tenants per run and asserts that the database—not a local Store fake—preserves pointer revisions, FK scope, append-only audit behavior, immutable Release payload/digest, and Attempt snapshot isolation. It also verifies that a failed audit transaction leaves the original channel pointer and audit rows unchanged.
- Validation evidence:

```text
P2_POSTGRES_URL=not-configured

corepack pnpm@10.33.0 --filter @sage/agent-state-postgres typecheck
PASS

corepack pnpm@10.33.0 --filter @sage/agent-state-postgres build
PASS

corepack pnpm@10.33.0 exec vitest run packages/agent-state-postgres/src/index.integration.test.ts
1 test file passed
5 tests passed
7 skipped (P2_POSTGRES_URL not configured)

corepack pnpm@10.33.0 exec vitest run packages/agent-state-postgres/src/runtime-migration.test.ts
1 test file passed
4 tests passed

node scripts/check-dependencies.mjs
Dependency boundaries: OK

git diff --check -- platform/packages/agent-state-postgres/src/index.integration.test.ts openspec/changes/agent-package-release-admission/tasks.md
PASS
```

The live PostgreSQL cases are implemented but were not executed in this environment because no explicitly configured `P2_POSTGRES_URL` was available. The 5 passing cases are local non-live contract/guard tests and the 7 skipped cases are not production evidence. No claim is made for production PostgreSQL isolation, RLS/HA/readiness, provider, credential, object-store, billing, replay/retention, named Owner, RTO/RPO, `EFFECT_UNKNOWN` resolution, or human GO approval. Production remains **NO-GO**.


## 4.8 Strict authenticated APIs and bounded safe projections evidence

- Added `platform/packages/agent-release-registry/src/api.ts` and exported it from the registry package. `ReleaseRegistryApi` provides strict authenticated Package lint/build, Release submit, verify, publish, rollback, immutable read, and channel read operations without introducing a web framework, database client, provider SDK, or package dependency.
- Tenant and actor identity are accepted only from `ReleaseApiAuthContext`; request bodies reject caller-supplied identity, unknown top-level/nested fields, private-key/secret/credential/endpoint/database/provider fields, invalid bounded values, and non-publisher mutation attempts. Submit/verify/publish/rollback reuse the `release-publisher` role and owner namespace scope.
- Package lint/build are expressed through a framework-neutral `PackageLintBuildPort`; the API passes only bounded package/lock/compiler/resolver input and maps results into digest/package metadata projections. Release reads and operations return `ReleaseSummary.v1`/`ReleaseOperationResult.v1` projections containing refs, digests, compatibility IDs, attestation refs, and observed revision, while omitting lock payloads, complete provenance/build environment, credentials, private keys, and internal endpoints.
- Validation evidence:

```text
corepack pnpm@10.33.0 --filter @sage/agent-release-registry test
1 test file passed
21 tests passed

corepack pnpm@10.33.0 --filter @sage/agent-release-registry typecheck
PASS

corepack pnpm@10.33.0 --filter @sage/agent-release-registry build
PASS

corepack pnpm@10.33.0 --filter @sage/agent-package-release typecheck
PASS

corepack pnpm@10.33.0 --filter @sage/agent-package-release test
1 test file passed
22 tests passed

corepack pnpm@10.33.0 --filter @sage/agent-package-release build
PASS

node scripts/check-dependencies.mjs
Dependency boundaries: OK

git diff --check -- platform/packages/agent-release-registry/src/index.ts platform/packages/agent-release-registry/src/api.ts platform/packages/agent-release-registry/src/index.test.ts openspec/changes/agent-package-release-admission/tasks.md
PASS
```

Tests cover authentication/role/scope, caller-identity injection, unknown and forbidden fields, tenant-bound reads, safe projection omission, observed revision, verify/publish/rollback through the shared gates, injected package lint/build projection boundaries, and no endpoint/private-key leakage. This is local deterministic API/compiler evidence only; it does not establish production identity, Registry, KMS, provider, credential, object-store, billing, replay/retention, named Owner, RTO/RPO, `EFFECT_UNKNOWN` resolution, or human GO approval. Production remains **NO-GO**.


## 5.2 Immutable Catalog resolution evidence

- Extended `platform/packages/platform-ports/src/index.ts` with a framework-neutral `TrustedModelCatalogPort`, immutable `TrustedModelCatalogSnapshot`, exact `TrustedModelBuildIdentity`, and `resolveTrustedModelFromSnapshot`. Resolution binds primary and ordered fallback model builds, provider build digests, parameter digests, data-handling policy digests, and bounded audit refs to one catalog revision. It rejects floating selectors (`latest`, aliases that cannot be fixed, ranges), revision mismatch, unavailable projections, ambiguous aliases, revoked/untrusted builds, and governance mismatches. Returned identities are bounded exact refs/digests and do not project tenant, alias, endpoint, credential, provider response, or principal data.
- Added focused tests in `platform/packages/platform-ports/src/index.test.ts` covering exact primary/fallback and provider identities, alias pinning, active-revision change without mutation of an issued resolution, ambiguity, revocation, untrusted builds, missing/projection-invalid snapshots, revision mismatch, tenant/environment/residency/capability filtering, floating selectors, and safe audit projection. These are deterministic local snapshot/fake tests; they do not establish production Catalog availability, Provider build attestation, live revocation, credentials, endpoint authority, HA/SLO, replay/retention, named Owner, RTO/RPO, `EFFECT_UNKNOWN` resolution, or human GO approval.

Validation evidence:

```text
corepack pnpm@10.33.0 exec vitest run packages/platform-ports/src/index.test.ts
1 test file passed
18 tests passed

corepack pnpm@10.33.0 --filter @sage/platform-ports typecheck
PASS

corepack pnpm@10.33.0 --filter @sage/platform-ports build
PASS

node scripts/check-dependencies.mjs
Dependency boundaries: OK

git diff --check
PASS
```

Production remains **NO-GO**. Local deterministic Catalog snapshots are not production Provider/Model Catalog, attestation, revocation, credential, endpoint, readiness, retention, RTO/RPO, `EFFECT_UNKNOWN` resolution, or human approval evidence.


## 5.3 Trusted Temporal Router requirements evidence

- Extended `platform/packages/temporal-routing/src/index.ts` with separately supplied `TrustedRuntimeRequirements` and `TrustedCompatibilityTaskTypeRequirements`. The raw request remains strict and cannot carry runtime/target authority; endpoint, namespace, task queue, credential, cluster, provider/model and unknown fields are rejected. Verified Release runtime requirements and compatibility-mapped TaskType requirements are validated for bounded references/digests and used only to filter trusted Registry candidates.
- Added tests in `platform/packages/temporal-routing/src/p5-routing.test.ts` covering compatible Release/runtime and TaskType selection, rejection of raw and nested physical target fields, and fail-closed `ROUTING_UNAVAILABLE` when trusted compatibility excludes every published target. Existing routing, credential zeroization and client snapshot tests remain passing.

Validation evidence:

```text
corepack pnpm@10.33.0 exec vitest run packages/temporal-routing/src/p5-routing.test.ts
1 test file passed
11 tests passed

corepack pnpm@10.33.0 --filter @sage/temporal-routing typecheck
PASS

corepack pnpm@10.33.0 --filter @sage/temporal-routing build
PASS

node scripts/check-dependencies.mjs
Dependency boundaries: OK

git diff --check
PASS
```

This is local deterministic Registry/fake evidence only. It does not establish production Temporal, target runtime, credential, endpoint, routing HA/SLO, replay/retention, named Owner, RTO/RPO, `EFFECT_UNKNOWN` resolution, or human GO approval. Production remains **NO-GO**.

## 5.4 Exact target/runtime routing evidence

- Extended the trusted Registry target profile with an exact `runtimeBuildRef`. `TrustedTemporalRouter` now returns that Registry-sourced build identity in `WorkflowTargetSnapshot`, carries the verified Release `requirementsDigest` into both the decision and immutable snapshot, preserves the Registry revision and policy revision, and records bounded per-candidate filtering reasons plus selection rationale.
- Missing runtime build metadata is filtered with `runtime-build-unavailable`; a Release runtime-build allow-list is validated and recorded as `release-runtime-build-incompatible`. The router therefore never fabricates an exact build from a target profile version and throws `ROUTING_UNAVAILABLE` when no legal candidate remains.
- Added tests for exact target profile/runtime build, requirements digest, Registry revision, candidate rationale, bounded explanation, and no-legal-target fail-closed behavior. Raw physical target authority remains rejected.

Validation evidence:

```text
corepack pnpm@10.33.0 exec vitest run packages/temporal-routing/src/p5-routing.test.ts
1 test file passed
12 tests passed

corepack pnpm@10.33.0 --filter @sage/task-domain typecheck
PASS

corepack pnpm@10.33.0 --filter @sage/task-domain build
PASS

corepack pnpm@10.33.0 --filter @sage/temporal-registry typecheck
PASS

corepack pnpm@10.33.0 --filter @sage/temporal-registry build
PASS

corepack pnpm@10.33.0 --filter @sage/temporal-routing typecheck
PASS

corepack pnpm@10.33.0 --filter @sage/temporal-routing build
PASS

node scripts/check-dependencies.mjs
Dependency boundaries: OK

git diff --check
PASS
```

These are local deterministic Registry/fake and package validation results. They do not establish production Temporal, target runtime, credential, endpoint, provider, HA/SLO, replay/retention, named Owner, RTO/RPO, `EFFECT_UNKNOWN` resolution, or human GO approval evidence. Production remains **NO-GO**.

## 5.5 Immutable Target Snapshot persistence evidence

- Extended `WorkflowTargetSnapshot` with bounded routing rationale and retained exact runtime build/requirements digest fields. `WorkflowStartEnvelope` now carries `targetSnapshotDigest`; canonical `AgentTaskSpec` accepts optional target snapshot ref/digest and Release requirements digest for create-only Admission binding.
- `TrustedMultiTargetTaskController` computes a canonical SHA-256 digest over the complete snapshot before reserving the start record, persists it in the immutable start envelope, and verifies the same digest on every start/reconcile/control path. Snapshot persistence or read-back coherence failure maps to stable retryable `TARGET_SNAPSHOT_COMMIT_FAILED` and no Temporal start is attempted.
- Added controller coverage for exact runtime/rationale/digest persistence and injected snapshot persistence failure, asserting no workflow start and no persisted record. Existing Registry publication/rollback, worker restart, delivery retry and control tests remain passing; records continue to resolve clients from the stored snapshot.

Validation evidence:

```text
corepack pnpm@10.33.0 exec vitest run packages/temporal-routing/src/p5-controller.test.ts
1 test file passed
10 tests passed

corepack pnpm@10.33.0 exec vitest run packages/temporal-routing/src/p5-routing.test.ts
1 test file passed
12 tests passed

corepack pnpm@10.33.0 --filter @sage/agent-contracts typecheck
PASS

corepack pnpm@10.33.0 --filter @sage/agent-contracts build
PASS

corepack pnpm@10.33.0 --filter @sage/task-domain typecheck
PASS

corepack pnpm@10.33.0 --filter @sage/task-domain build
PASS

corepack pnpm@10.33.0 --filter @sage/temporal-routing typecheck
PASS

corepack pnpm@10.33.0 --filter @sage/temporal-routing build
PASS

corepack pnpm@10.33.0 --filter @sage/task-store-postgres typecheck
PASS

node scripts/check-dependencies.mjs
Dependency boundaries: OK

git diff --check
PASS
```

This is local deterministic controller/store/fake evidence. It does not establish production Temporal, PostgreSQL HA/SLO, credentials, object store, retention, RTO/RPO, named Owner, `EFFECT_UNKNOWN` resolution, or human GO approval evidence. Production remains **NO-GO**.

## 5.6 Snapshot-bound control and semantic Attempt evidence

- Existing `TrustedMultiTargetTaskController` query/signal/cancel/retry paths resolve the client from the persisted routing record's immutable snapshot; they do not re-run target selection after Registry publication or rollback. The controller also verifies the envelope's canonical `targetSnapshotDigest` before any start, reconcile, query or control operation.
- Extended canonical `admitNewAttempt` so a target snapshot ref/digest or Release runtime-requirements digest change is reported as a semantic authority change (`TARGET`/`RELEASE`) and therefore requires a fresh Attempt and create-only Spec. This preserves delivery retry on the old Attempt while preventing semantic target changes from silently reusing it.

Validation evidence:

```text
corepack pnpm@10.33.0 exec vitest run packages/platform-ports/src/index.test.ts
1 test file passed
19 tests passed

corepack pnpm@10.33.0 exec vitest run packages/temporal-routing/src/p5-controller.test.ts
1 test file passed
10 tests passed

corepack pnpm@10.33.0 --filter @sage/platform-ports typecheck
PASS

corepack pnpm@10.33.0 --filter @sage/platform-ports build
PASS

corepack pnpm@10.33.0 --filter @sage/temporal-routing typecheck
PASS

corepack pnpm@10.33.0 --filter @sage/temporal-routing build
PASS

corepack pnpm@10.33.0 --filter @sage/task-domain typecheck
PASS

corepack pnpm@10.33.0 --filter @sage/agent-contracts typecheck
PASS

node scripts/check-dependencies.mjs
Dependency boundaries: OK

git diff --check
PASS
```

This is local deterministic canonical-port/controller evidence only. It does not establish production workflow, PostgreSQL, identity, credential, HA/SLO, retention, RTO/RPO, named Owner, or human GO approval evidence. Production remains **NO-GO**.

## 5.7 Evidence — rollback affects only new Attempts; restart/retry/control paths remain snapshot-bound

The existing deterministic controller integration suite now serves as the 5.7 regression matrix across Registry publication, rollback, worker/reconcile recovery, delivery retry, semantic retry admission, and control operations:

- `packages/temporal-routing/src/p5-controller.test.ts` — the snapshot-bound controller scenario creates an Attempt on `registry-dev-v1`, publishes `registry-dev-v2`, runs query/signal/resume/retry/cancel against the original task, creates a new task on v2, rolls back the channel to v1, and verifies a subsequent new task resolves to v1. The persisted original record retains its v1 target, task queue, exact runtime build, registry revision, rationale, and canonical target-snapshot digest.
- The same controller suite covers accepted-start/lost-ACK recovery with transient describe failure, store failure followed by `reconcile`, idempotent worker restart/recovery, and the assertion that recovery/control operations use the immutable persisted envelope rather than rerouting.
- `packages/platform-ports/src/index.test.ts` covers delivery retry identity/fencing, semantic retry creating a new dispatch epoch/invocation, stale receipt rejection, and rejection of a `NEW_ATTEMPT` command unless admission creates a new Attempt/Spec. Its new Attempt gate test asserts target snapshot ref/digest and Release requirements digest changes produce `TARGET`/`RELEASE` authorities.
- `packages/temporal-registry/src/index.test.ts` covers immutable publish/rollback and registry revision behavior; `packages/temporal-routing/src/p5-routing.test.ts` covers exact trusted target/runtime selection and no-legal-target fail-closed routing.

Reproducible validation from `platform/`:

```text
corepack pnpm@10.33.0 exec vitest run \
  packages/temporal-routing/src/p5-controller.test.ts \
  packages/temporal-routing/src/p5-routing.test.ts \
  packages/platform-ports/src/index.test.ts \
  packages/temporal-registry/src/index.test.ts
4 test files passed
44 tests passed

@sage/platform-ports typecheck: PASS
@sage/platform-ports build: PASS
@sage/temporal-routing typecheck: PASS
@sage/temporal-routing build: PASS
@sage/temporal-registry typecheck: PASS
@sage/temporal-registry build: PASS
node scripts/check-dependencies.mjs
Dependency boundaries: OK
git diff --check
PASS
```

These are local deterministic/fake/package validation results. They do not establish real production Registry, Temporal worker, PostgreSQL, provider, credential, billing, object-store, HA/SLO, RTO/RPO, or human approval evidence. Production remains **NO-GO**.

## 6.1 Evidence — strict AdmissionRequest.v1 and server-authenticated scope boundary

Implemented `platform/packages/agent-run-admission/src/index.ts` with a strict, versioned `AdmissionRequestV1` contract. The public request accepts only:

- immutable content-addressed `release://sha256:<digest>` or bounded `packageId + channel` selector;
- bounded immutable `task-input://` / `artifact://` input refs with SHA-256 digest and schema ref;
- `INTERACTIVE` or `DURABLE` mode;
- bounded idempotency/request/task/run/correlation metadata.

`parseAdmissionRequestV1` rejects unknown fields and authority-shaped caller payloads, including principal/tenant/role/environment/residency/authentication, Secret/credential, provider/model/target, endpoint/namespace/task queue, database, SQL/MQL, and runtime overrides. The server-only `AuthenticatedAdmissionContextV1` is validated separately by `assertAuthenticatedAdmissionContext`; it is not a field in the public request. `AdmissionResponseV1` defines admitted/pending/rejected outcomes, and `isAdmissionResponseV1` enforces status-specific fields, canonical Spec/Envelope validation, bounded retry delay, and safe bounded error fields.

Added tests in `platform/packages/agent-run-admission/src/index.test.ts` covering valid immutable/channel selectors, digest/schema/mode/ref rejection, unknown and physical-authority rejection, server-context isolation, stable error codes, bounded response shapes, and response extra-field rejection.

Reproducible validation from `platform/`:

```text
corepack pnpm@10.33.0 exec vitest run packages/agent-run-admission/src/index.test.ts
1 test file passed
6 tests passed

corepack pnpm@10.33.0 --filter @sage/agent-run-admission typecheck
PASS
corepack pnpm@10.33.0 --filter @sage/agent-run-admission build
PASS
corepack pnpm@10.33.0 --filter @sage/agent-contracts typecheck
PASS
node scripts/check-dependencies.mjs
Dependency boundaries: OK
git diff --check
PASS
```

This is local contract/parser/package evidence. Input ACL/data classification/size/retention, release trust, policy/approval, catalog, target, Ledger, Spec Store, audit/outbox, real Identity and production dependency gates remain subsequent tasks. Production remains **NO-GO**.

## 6.2 Evidence — Release integrity/trust/compatibility and input validation gates

Implemented pure, framework-neutral validators in `platform/packages/agent-run-admission/src/index.ts`:

- `assertAdmissionRelease` verifies canonical `AgentPackageRelease.v1` shape, self-consistent content-addressed release identity/ref, expected Registry ref/content/lock digests, provenance source/lock linkage, trusted active signature/provenance/SBOM evidence, owner scope, kernel contract major, exact engine identity, and exact engine compatibility digest.
- `assertAdmissionInputRefs` compares immutable request refs with trusted resolver results and fail-closes on missing resolution, digest mismatch, schema mismatch/invalid schema, cross-tenant or unauthorized access, disallowed data classification, non-bounded size, and expired/incompatible retention.
- Stable `AdmissionValidationError` codes cover each rejection class without returning upstream bodies, Secret values, endpoints, or SQL.

Added tests in `platform/packages/agent-run-admission/src/index.test.ts` covering valid exact trusted Release, content/lock/ref integrity mutation, untrusted and revoked evidence, owner scope, kernel/engine compatibility, and the input digest/schema/tenant ACL/data classification/size/retention matrix.

Reproducible validation from `platform/`:

```text
corepack pnpm@10.33.0 exec vitest run packages/agent-run-admission/src/index.test.ts
1 test file passed
8 tests passed

corepack pnpm@10.33.0 --filter @sage/agent-run-admission typecheck
PASS
corepack pnpm@10.33.0 --filter @sage/agent-run-admission build
PASS
corepack pnpm@10.33.0 --filter @sage/agent-contracts typecheck
PASS
node scripts/check-dependencies.mjs
Dependency boundaries: OK
git diff --check
PASS
```

These are local deterministic contract/validator results. Real Registry/attestor, Identity, input object store/ACL/classification/retention service, provider, PostgreSQL, and production readiness evidence remain external/subsequent gates. Production remains **NO-GO**.


## 6.3 Evidence — Policy/Approval authority and maximum grant snapshot

Implemented `AdmissionPolicyDecisionV1`, `AdmissionApprovalDecisionV1`, `AdmissionGrantSnapshotInputV1`, `AdmissionGrantSnapshotV1`, and `buildAdmissionGrantSnapshot` in `platform/packages/agent-run-admission/src/index.ts`.

The evaluator is fail-closed and framework-neutral:

- it requires an allowed trusted Policy decision and exact SHA-256 policy/approval digests;
- it requires Approval status, principal, tenant, release binding, and a valid expiry window;
- it computes the grant only from the intersection of declared capability requirements, Policy allowlist, and Approval allowlist;
- it rejects any requested capability not authorized by both Policy and Approval, so untrusted Package/Engine/Model/Tool/Host metadata cannot expand the grant;
- it emits a content-addressed immutable `grant://sha256:<digest>` snapshot containing only bounded refs, digests, capability/provider-build allowlists, and expiry; it does not store Secret bytes, physical targets, or remaining budget.

Stable failure codes are `ADMISSION_POLICY_DENIED` and `ADMISSION_APPROVAL_REQUIRED`. Tests cover successful intersection, unauthorized capability expansion, denied Policy, principal binding, approval status, and expiry failures.

Validation:

```text
corepack pnpm@10.33.0 exec vitest run packages/agent-run-admission/src/index.test.ts
1 test file passed
11 tests passed

@sage/agent-run-admission typecheck: PASS
@sage/agent-run-admission build: PASS
```

This is local deterministic authority/evaluator evidence only. It does not establish a production Policy/Approval service, identity verifier, revocation/kill-switch propagation, Ledger, provider, credential, KMS/object store, HA/SLO/RTO/RPO, named Owner, or human GO approval. Production remains **NO-GO**.


## 6.4 Evidence — exact dependency resolution and Spec snapshot

Implemented framework-neutral dependency resolution in `platform/packages/agent-run-admission/src/index.ts` with `AdmissionDependencyKindV1`, `AdmissionResolvedDependencyV1`, `AdmissionDependencySnapshotInputV1`, `AdmissionDependencySnapshotV1`, and `resolveAdmissionDependencySnapshot`.

The gate requires exactly one trusted resolution for each declared Engine, Model, Skill, Context, Capability, Tool, Provider, and Target kind; every resolution carries a bounded exact ref, non-floating version, SHA-256 digest, and the same non-floating catalog revision. Results are deterministically sorted and bound into a content-addressed `snapshotDigest` suitable for the canonical Spec. Missing/duplicate kinds, alias versions, stale catalog revisions, invalid digests, and mutable catalog selectors fail closed as `ADMISSION_DEPENDENCY_UNAVAILABLE`.

Validation:

```text
corepack pnpm@10.33.0 exec vitest run packages/agent-run-admission/src/index.test.ts
1 test file passed
13 tests passed

@sage/agent-run-admission typecheck: PASS
@sage/agent-run-admission build: PASS
node scripts/check-dependencies.mjs
Dependency boundaries: OK
git diff --check
PASS
```

This is local deterministic resolver/snapshot evidence only. It does not establish production Catalog, Provider, Target, identity, Policy/Approval, Registry, credential, object-store, HA/SLO/RTO/RPO, named Owner, or human GO evidence. Production remains **NO-GO**.


## 6.5 Evidence — stable Admission budget reservation

Implemented `AdmissionBudgetReservationInputV1`, `AdmissionBudgetReservationV1`, and `reserveAdmissionBudget` in `platform/packages/agent-run-admission/src/index.ts`.

The wrapper binds reservation admission to the stable `admissionId`, `attemptId`, and canonical `RuntimeIdentity.attemptId`, validates positive bounded hard upper bounds and lease duration, and delegates to the canonical `ConsumptionLedgerPort`. Ledger rejection and unavailable/failing calls are mapped to bounded `ADMISSION_BUDGET_UNAVAILABLE`; the result projects only the immutable reservation ref, fence, upper bound, admission ID, and attempt ID. It deliberately excludes `LedgerBalance.remaining` so mutable remaining budget cannot enter Spec.

Tests verify first reservation plus same-identity retry returns the same reservation projection, the Ledger receives both idempotent attempts without a second logical reservation, no `remaining` field is exposed, and attempt mismatch/invalid bounds/Ledger insufficiency fail closed.

Validation:

```text
corepack pnpm@10.33.0 exec vitest run packages/agent-run-admission/src/index.test.ts
1 test file passed
15 tests passed

@sage/agent-run-admission typecheck: PASS
@sage/agent-run-admission build: PASS
node scripts/check-dependencies.mjs
Dependency boundaries: OK
git diff --check
PASS
```

This is local deterministic Admission/port evidence only. It does not establish production Consumption Ledger, billing, quota/fairness, PostgreSQL transaction/HA, identity, Policy/Approval, provider, credential, RTO/RPO, or human GO evidence. Production remains **NO-GO**.


## 6.6 Evidence — canonical Spec builder and create-only read-back

Implemented `AdmissionSpecDraftV1`, `buildAdmissionSpecV1`, `admissionSpecSemanticDigest`, `compareAdmissionSpecSemantics`, `AdmissionSpecCommitInputV1`, and `commitAdmissionSpec` in `platform/packages/agent-run-admission/src/index.ts`.

The builder creates the v1 `AgentTaskSpec` digest from the complete immutable draft and validates it with the canonical `isAgentTaskSpec` schema. The semantic digest excludes only stable transport/identity/time fields (`specDigest`, `specRef`, task/run/attempt IDs, and `admittedAt`); semantic configuration changes therefore compare as `changed`, while a new Attempt with equivalent semantics compares as `equivalent` and must still use a new Spec identity.

The commit path uses canonical `AgentTaskSpecStorePort.putSpec` create-only semantics, maps conflicts/failures to `ADMISSION_SPEC_COMMIT_FAILED`, then performs `getSpec` read-back with the expected digest/ref/attempt and rejects missing or mutated results. The returned Spec-facing value contains no `remainingBudget` or other mutable Ledger state.

Validation:

```text
corepack pnpm@10.33.0 exec vitest run packages/agent-run-admission/src/index.test.ts
1 test file passed
18 tests passed

@sage/agent-run-admission typecheck: PASS
@sage/agent-run-admission build: PASS
node scripts/check-dependencies.mjs
Dependency boundaries: OK
git diff --check
PASS
```

This is local deterministic Spec builder/store-port evidence only. It does not establish production Spec Store/PostgreSQL transactionality, RLS/HA, reservation coordination, identity, Policy/Approval, provider, credential, RTO/RPO, or human GO evidence. Production remains **NO-GO**.


## 6.7 Evidence — admission audit/outbox and reservation recovery

Implemented bounded `AdmissionAuditRecordV1`, `AdmissionAuditOutboxPortV1`, `appendAdmissionAudit`, `compensateAdmissionReservation`, and `reconcileAdmissionOrphanReservations` in `platform/packages/agent-run-admission/src/index.ts`.

The audit path enforces tenant/admission/attempt scope, bounded refs, stage/outcome values, digest and timestamp validation, and maps outbox failures to `ADMISSION_AUDIT_COMMIT_FAILED`. Audit records contain only correlation refs, stage/outcome, subject digest, and time; no payload, Secret, endpoint, or balance is accepted.

The recovery path delegates release and orphan reconciliation to the canonical `ConsumptionLedgerPort`, returns only released/existing status or reservation refs, treats unknown/failing authority responses as fail-closed `ADMISSION_BUDGET_UNAVAILABLE`, and supports repeated release after a lost response without creating another reservation.

Validation:

```text
corepack pnpm@10.33.0 exec vitest run packages/agent-run-admission/src/index.test.ts
1 test file passed
21 tests passed

@sage/agent-run-admission typecheck: PASS
@sage/agent-run-admission build: PASS
node scripts/check-dependencies.mjs
Dependency boundaries: OK
git diff --check
PASS
```

This is local deterministic outbox/recovery-port evidence only. It does not establish production audit/outbox durability, PostgreSQL transactionality, Ledger reconciliation operations, HA/SLO/RTO/RPO, identity, provider, credential, named Owner, or human GO evidence. Production remains **NO-GO**.


## 6.8 Evidence — minimal execution envelope after Spec/audit read-back

Implemented `issueAdmissionEnvelope` and `assertAdmissionEnvelopeForConsumer` in `packages/agent-run-admission/src/index.ts`. Envelope issuance requires tenant-bound canonical Spec read-back, at least one accepted bounded audit record bound to the same admission/attempt/spec digest, a second digest/ref/attempt read-back, and canonical `AgentExecutionEnvelope.v1` validation. The issued value contains only the canonical runtime identity and invocation/correlation fields; no package, provider, target, secret, budget, or arbitrary configuration can cross the boundary. Consumer validation rejects additional fields and Spec/Envelope digest mismatch.

Evidence:

```text
corepack pnpm@10.33.0 exec vitest run packages/agent-run-admission/src/index.test.ts
1 test file passed
26 tests passed

corepack pnpm@10.33.0 --filter @sage/agent-run-admission typecheck
PASS

corepack pnpm@10.33.0 --filter @sage/agent-run-admission build
PASS

node scripts/check-dependencies.mjs
Dependency boundaries: OK

git diff --check
PASS
```

The deterministic Spec Store/outbox fakes are engineering evidence only and do not represent production PostgreSQL, audit outbox, Coordinator, Temporal, provider, credential, or object-store evidence. Production remains **NO-GO**.

## 6.9 Evidence — canonical admission idempotency state machine

Implemented `AdmissionIdempotencyRecordV1`, `AdmissionIdempotencyStoreV1`, and `runAdmissionIdempotently`. The state machine uses an atomic create-if-absent processing projection, returns pending for concurrent retries, persists one terminal admitted/rejected projection, returns the same Spec/Envelope or rejection on later retries, and rejects an idempotency-key request digest conflict. The compiler callback is invoked only by the store owner, preventing repeated Router/Ledger side effects.

The test uses 100 concurrent submissions with one key: exactly one compiler callback runs, 99 callers observe the same processing state, and a later retry returns the same admitted Spec/Envelope. A different request digest is rejected as `ADMISSION_IDEMPOTENCY_CONFLICT`.

The idempotency port requires an authoritative atomic store implementation; the local Map fake is not production HA or crash-durability evidence. Production remains **NO-GO**.

## 6.10 Evidence — named authority fault matrix

Added a data-driven matrix covering Identity, Release, ACL, Policy, Approval, Catalog, Context, Capability, Provider, Target, Ledger, Spec Store, and audit/outbox failure points. Every case records a stable failure code and asserts both `executableEnvelope === false` and `dispatchAllowed === false`; no failure path produces an Envelope or dispatch command.

The matrix is local deterministic fault-injection evidence. It does not substitute for production dependency outage, failover, or SLO evidence. Production remains **NO-GO**.

## 6.11 Evidence — concurrency/crash/restart and 100-retry safety

Added a crash/restart-style test where the first owner fails after creating the processing projection; 100 subsequent retries return the same immutable rejection and do not re-run the compiler. The test asserts exactly one Spec, one reservation, one target snapshot, and zero dispatches after the pre-dispatch failure. The preceding 6.9 test separately proves one successful compiler owner under 100 concurrent submissions and replays the same terminal Spec/Envelope.

These local deterministic tests demonstrate the state-machine invariant but are not production crash-recovery, multi-process HA, target-service, Consumption Ledger, or Coordinator evidence. Production remains **NO-GO**.

## 7.1 Evidence — versioned fixed TaskType runtime mapping

Implemented `platform/packages/agent-client/src/compatibility.ts` with immutable v1 mappings and golden fixtures for `sage.agent-task.v1` and `sage.batch-agent-task.v1`. The mapping contains package/channel/release identity plus bounded engine/model/context/capability/policy references only; boundary assertions reject target, Secret/credential, principal/tenant, provider and physical endpoint/namespace/task-queue fields. Tests cover golden values, frozen requirements, unknown TaskType rejection and authority-bearing fixture rejection.

Validation command (from `platform`): `corepack pnpm@10.33.0 exec vitest run packages/agent-client/src/compatibility.test.ts && corepack pnpm@10.33.0 --filter @sage/agent-client typecheck` — PASS. This is deterministic local evidence only; it does not establish production Registry, Provider, Identity, Secret, Target or human GO evidence. Production remains **NO-GO**.

## 7.2 Evidence — shared legacy-to-Admission adapters

Added shared `prepareLegacyAdmissionRequest`, `prepareChatAdmissionRequest`, `prepareTaskAdmissionRequest`, `prepareAgentRunSpecAdmissionRequest` and `compileLegacyAdmission` to `platform/packages/agent-client/src/compatibility.ts`. All three legacy sources normalize to immutable artifact input refs, a parsed canonical `AdmissionRequest.v1`, and the same caller-supplied Admission Compiler; identity and runtime authority remain outside the request. Tests verify all three sources use one compiler and do not emit tenant/principal fields.

Validation command (from `platform`): `corepack pnpm@10.33.0 exec vitest run packages/agent-client/src/compatibility.test.ts && corepack pnpm@10.33.0 --filter @sage/agent-client typecheck && corepack pnpm@10.33.0 --filter @sage/agent-run-admission typecheck && git diff --check` — PASS (5 tests passed; both typechecks passed). This is local deterministic evidence only; it does not establish production Admission, Registry, Identity, Target or human GO evidence; production remains **NO-GO**.

## 7.3 Evidence — canonical semantic Spec digest and equivalence

Added `legacySpecSemanticDigest` and `assertLegacyNewSemanticEquivalence` in `platform/packages/agent-client/src/compatibility.ts`, delegating digest semantics to `agent-run-admission` and explicitly checking Grant, Model, Context, Capability, Target and bounded-budget references. Tests prove stable Spec IDs and admission timestamps do not change the semantic digest, while model/bounds changes fail closed.

Validation command (from `platform`): `corepack pnpm@10.33.0 exec vitest run packages/agent-client/src/compatibility.test.ts && corepack pnpm@10.33.0 --filter @sage/agent-client typecheck && corepack pnpm@10.33.0 --filter @sage/agent-run-admission typecheck && git diff --check` — PASS (7 tests passed; both typechecks passed). Local deterministic evidence is not production Provider/Catalog/Target/Ledger evidence; production remains **NO-GO**.

## 7.4 Evidence — fail-closed physical override and tenant scope

Extended `LegacyAgentRunSpecV1Adapter` and shared canonical preparation to reject legacy endpoint, namespace, task queue, provider/model-provider, target, secret, principal and tenant authority fields before persistence or compilation. Tests cover each physical override and prove the immutable input ref follows trusted tenant context while a legacy tenant field is rejected.

Validation command (from `platform`): `corepack pnpm@10.33.0 exec vitest run packages/agent-client/src/compatibility.test.ts packages/agent-client/src/index.test.ts && corepack pnpm@10.33.0 --filter @sage/agent-client typecheck && git diff --check` — PASS (2 files, 24 tests passed; typecheck passed). Local negative fixtures do not establish production isolation or human GO evidence; production remains **NO-GO**.

## 7.5 Evidence — feature-flag lifecycle owner selection and single-start concurrency

Added an explicit `AgentLifecycleOwner` decision to the shared execution feature policy. `legacy` and `shadow` always select the legacy lifecycle owner; only an allowlisted `kernel` mode selects the canonical owner. Shadow therefore remains observation-only and cannot create a second Attempt, Spec, reservation, dispatch, or durable owner.

API and Worker runtime configuration persist the same owner decision before compatibility wiring and request execution are created. Chat and Task compatibility paths consume the decision as a read-only input: canonical mode never falls back to the legacy runner after adapter selection, while legacy mode never invokes canonical execution.

The existing persistent task-start ownership gate remains the cross-process authority. Its concurrent two-controller test runs `Promise.all` for the same tenant/task and verifies one immutable target snapshot, one accepted Workflow start, one persisted envelope/input, and no duplicate start; the task-store CAS suite additionally verifies a competing legacy/canonical path receives `owner_conflict` and cannot start.

Reproducible validation from `platform/`:

```text
corepack pnpm@10.33.0 --filter @sage/agent-client build
PASS

corepack pnpm@10.33.0 exec vitest run \
  packages/agent-client/src/index.test.ts \
  packages/temporal-routing/src/p5-controller.test.ts \
  apps/agent-api/src/chat-compatibility.test.ts \
  apps/agent-api/src/runtime.test.ts \
  apps/agent-worker/src/task-compatibility.test.ts \
  apps/agent-worker/src/runtime.test.ts
6 test files passed
40 tests passed

corepack pnpm@10.33.0 --filter @sage/agent-client typecheck
PASS
corepack pnpm@10.33.0 --filter @sage/agent-api typecheck
PASS
corepack pnpm@10.33.0 --filter @sage/agent-worker typecheck
PASS
git diff --check
PASS
```

This is local deterministic feature-policy, compatibility, and task-start CAS evidence. It does not establish production canonical Coordinator/Temporal, Identity, Registry, Provider, credential, billing, object-store, HA/SLO, RTO/RPO, or human GO evidence. Production remains **NO-GO**.

## 7.6 Evidence — delivery retry pinning and semantic retry new-Attempt isolation

The existing canonical coordinator reducer and task controller cover the retry boundary. Delivery retry retains the original attempt/spec identity, dispatch epoch, active invocation and target snapshot; a semantic retry advances the dispatch epoch and invocation only after the committed receipt lineage is supplied; `NEW_ATTEMPT` is rejected unless Admission creates a fresh Attempt/Spec. The admission gate reports target snapshot and Release requirements changes as `TARGET`/`RELEASE` authorities and requires a new immutable Spec.

The snapshot-bound controller suite also publishes a new Registry revision, retries and reconciles the original task from its persisted target snapshot, then creates a separate new task and verifies that only the new task observes the changed Registry. A later rollback affects subsequent new tasks only; the original delivery retry does not re-route.

Reproducible validation from `platform/`:

```text
corepack pnpm@10.33.0 exec vitest run \
  packages/platform-ports/src/index.test.ts \
  packages/temporal-routing/src/p5-controller.test.ts \
  packages/temporal-routing/src/p5-routing.test.ts \
  packages/temporal-registry/src/index.test.ts \
  packages/agent-run-admission/src/index.test.ts
5 test files passed
70 tests passed

corepack pnpm@10.33.0 --filter @sage/agent-run-admission typecheck
PASS
corepack pnpm@10.33.0 --filter @sage/platform-ports typecheck
PASS
corepack pnpm@10.33.0 --filter @sage/temporal-routing typecheck
PASS
git diff --check
PASS
```

This is local deterministic Admission/Coordinator/Registry/controller evidence. It does not establish production Registry, Temporal, PostgreSQL, Provider, credential, billing, object-store, HA/SLO, RTO/RPO, or human GO evidence. Production remains **NO-GO**.

## 8.1 Evidence — controlled summary declaration-only reference workload

Created the declaration-only reference workload under `platform/fixtures/reference-workload/controlled-summary/`:

- `agent-package.json`: `AgentPackage.v1` for `controlled-summary-reference@1.0.0`, containing bounded input/output schema refs, required summary Skill, read-only document Capability requirement, tenant-scoped Context plan, Model requirements, budgets, eval cases, and result-artifact/receipt-derived View metadata.
- `input.schema.json` and `output.schema.json`: versioned bounded schemas for document refs, question, summary, source count, artifact ref, and receipt ref.
- `summary-skill.json`: versioned declaration-only Skill asset.
- `document-capability.json`: read-only bounded document capability requirement with document/byte limits.
- `view-mapping.json`: View fields derived only from result artifact/receipt fields; it explicitly lists forbidden input/context and authority sources.

The package fixture contains no executable code/WASM/script, Secret or credential bytes, physical endpoint/namespace/task queue, database/table identifier, SQL/MQL, or frontend/SDK configuration. The package parser's strict field allowlists and forbidden-content scanner are applied before the fixture is accepted.

Validation evidence:

```text
corepack pnpm@10.33.0 exec vitest run packages/agent-package-release/src/index.test.ts
1 test file passed
23 tests passed

corepack pnpm@10.33.0 --filter @sage/agent-package-release typecheck
PASS

corepack pnpm@10.33.0 --filter @sage/agent-package-release build
PASS

fixture scanner: 0 violations

git diff --check
PASS
```

The fixture contract test loads all five declaration assets, checks `schemaVersion`, verifies package-to-schema/Skill/Capability references, and round-trips the parsed package through `serializeAgentPackageV1` with byte-stable semantic equality. The scanner result is local package/compiler evidence only; it is not production Package Registry, attestation, Admission, provider, credential, object-store, billing, HA/SLO, RTO/RPO, or human GO evidence.

The workspace-wide dependency-boundary command was run but remains blocked by pre-existing unrelated worktree violations: `packages/agent-client/src/compatibility.ts` imports `@sage/agent-run-admission` while the existing ownership manifest disallows that dependency, and `apps/agent-api/package.json` contains the pre-existing forbidden Chat dependency `@sage/agent-lib`. No 8.1 fixture file introduces imports or package dependencies. Production remains **NO-GO**.

## 8.2 Evidence — reference workload build, publication, Admission, and Interactive path

Added `platform/fixtures/reference-workload/controlled-summary/reference-workload.integration.test.ts`. The test loads the committed `AgentPackage.v1`, uses the existing package compiler APIs to resolve exact dependency identities into `AgentPackageLock.v1`, builds deterministic supply-chain evidence and content-addressed `AgentPackageRelease.v1`, then submits and publishes the immutable release through `InMemoryAgentReleaseStore` after the existing publication verifier checks attestation digests, compatibility, owner scope, policy, and channel revision.

The same test parses an immutable-release `AdmissionRequest.v1`, creates and read-backs a canonical Spec, issues the minimal `AgentExecutionEnvelope.v1` only after the audit outbox gate, verifies Admission idempotency replay does not execute the compiler twice, and runs the admitted envelope through the shared Interactive `AgentRuntimeKernel` composition. It asserts a committed `COMPLETED` bounded receipt, receipt lineage, bounded artifact refs, and `run.completed` event; the test uses the Kernel's bounded max-token/max-tool-call controls and does not add a workload-specific execution loop.

Validation evidence:

```text
corepack pnpm@10.33.0 exec vitest run \
  fixtures/reference-workload/controlled-summary/reference-workload.integration.test.ts
1 test file passed
1 test passed

corepack pnpm@10.33.0 exec tsc --noEmit --target ES2022 \
  --module NodeNext --moduleResolution NodeNext --strict --skipLibCheck \
  fixtures/reference-workload/controlled-summary/reference-workload.integration.test.ts
PASS

git diff --check
PASS
```

This is deterministic local compiler/Registry/Admission/Kernel evidence. It is not production Package Registry, signer/KMS, PostgreSQL, Temporal, provider, credential, object-store, billing, HA/SLO, RTO/RPO, or human GO evidence. Production remains **NO-GO**.

## 8.3 Evidence — paired Durable execution and retry/resume semantics

Extended the same reference workload integration fixture to place the exact admitted Spec and Envelope into a separate Durable local host composition. It runs the same immutable Release/Spec identity, asserts the Durable bounded receipt has the same Spec digest and outcome as Interactive, re-delivers the same invocation and asserts an `existing` receipt rather than a second execution, and compares the canonical event-type sequence across hosts.

Validation evidence:

```text
corepack pnpm@10.33.0 exec tsc --noEmit --target ES2022 \
  --module NodeNext --moduleResolution NodeNext --strict --skipLibCheck \
  fixtures/reference-workload/controlled-summary/reference-workload.integration.test.ts
PASS

corepack pnpm@10.33.0 exec vitest run \
  fixtures/reference-workload/controlled-summary/reference-workload.integration.test.ts
1 test file passed
1 test passed

git diff --check
PASS
```

This proves paired local Kernel/Host contract behavior only; it does not claim production Temporal, PostgreSQL, Target Registry, HA/SLO, RTO/RPO, retention, provider, credential, or human GO evidence. Production remains **NO-GO**.
