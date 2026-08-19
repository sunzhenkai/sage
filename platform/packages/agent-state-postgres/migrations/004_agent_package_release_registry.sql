BEGIN;

CREATE TABLE IF NOT EXISTS agent_package_releases (
  tenant_id text NOT NULL CHECK (length(trim(tenant_id)) > 0),
  owner_namespace text NOT NULL CHECK (owner_namespace ~ '^[A-Za-z0-9._/-]+$'),
  package_id text NOT NULL CHECK (length(trim(package_id)) > 0),
  package_version text NOT NULL CHECK (length(trim(package_version)) > 0),
  release_ref text NOT NULL CHECK (release_ref LIKE 'release://%'),
  release_id text NOT NULL CHECK (release_id ~ '^sha256:[a-f0-9]{64}$'),
  content_digest text NOT NULL CHECK (content_digest ~ '^sha256:[a-f0-9]{64}$'),
  lock_digest text NOT NULL CHECK (lock_digest ~ '^sha256:[a-f0-9]{64}$'),
  release_payload jsonb NOT NULL CHECK (jsonb_typeof(release_payload) = 'object'),
  lock_payload jsonb NOT NULL CHECK (jsonb_typeof(lock_payload) = 'object'),
  attestation_refs text[] NOT NULL CHECK (cardinality(attestation_refs) > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, release_ref),
  UNIQUE (tenant_id, release_id),
  UNIQUE (tenant_id, content_digest),
  UNIQUE (tenant_id, release_ref, owner_namespace, package_id),
  CHECK (release_payload ? 'releaseRef'),
  CHECK (release_payload ? 'contentDigest'),
  CHECK (release_payload ? 'lockDigest'),
  CHECK (NOT (release_payload ?| ARRAY['principalRef', 'secret', 'secretBytes', 'target', 'liveGrant', 'remainingBudget']))
);

CREATE OR REPLACE FUNCTION sage_agent_release_immutable_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'AGENT_RELEASE_IMMUTABLE: % is create-only', TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS agent_package_releases_immutable ON agent_package_releases;
CREATE TRIGGER agent_package_releases_immutable
BEFORE UPDATE OR DELETE ON agent_package_releases
FOR EACH ROW EXECUTE FUNCTION sage_agent_release_immutable_guard();

CREATE TABLE IF NOT EXISTS agent_release_attestations (
  tenant_id text NOT NULL,
  release_ref text NOT NULL,
  attestation_ref text NOT NULL CHECK (length(trim(attestation_ref)) > 0),
  attestation_kind text NOT NULL CHECK (attestation_kind IN ('sbom', 'provenance', 'signature', 'policy')),
  attestation_digest text NOT NULL CHECK (attestation_digest ~ '^sha256:[a-f0-9]{64}$'),
  attestation_payload jsonb NOT NULL CHECK (jsonb_typeof(attestation_payload) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, release_ref, attestation_ref),
  FOREIGN KEY (tenant_id, release_ref) REFERENCES agent_package_releases (tenant_id, release_ref),
  CHECK (NOT (attestation_payload ?| ARRAY['secret', 'secretBytes', 'privateKey', 'endpoint', 'fullEnvironment']))
);

DROP TRIGGER IF EXISTS agent_release_attestations_immutable ON agent_release_attestations;
CREATE TRIGGER agent_release_attestations_immutable
BEFORE UPDATE OR DELETE ON agent_release_attestations
FOR EACH ROW EXECUTE FUNCTION sage_agent_release_immutable_guard();

CREATE TABLE IF NOT EXISTS agent_release_channels (
  tenant_id text NOT NULL CHECK (length(trim(tenant_id)) > 0),
  owner_namespace text NOT NULL CHECK (owner_namespace ~ '^[A-Za-z0-9._/-]+$'),
  package_id text NOT NULL CHECK (length(trim(package_id)) > 0),
  channel text NOT NULL CHECK (channel ~ '^[A-Za-z0-9._/-]+$'),
  release_ref text NOT NULL,
  pointer_revision bigint NOT NULL DEFAULT 0 CHECK (pointer_revision >= 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, owner_namespace, package_id, channel),
  FOREIGN KEY (tenant_id, release_ref, owner_namespace, package_id)
    REFERENCES agent_package_releases (tenant_id, release_ref, owner_namespace, package_id)
);

CREATE TABLE IF NOT EXISTS agent_release_audit (
  audit_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id text NOT NULL CHECK (length(trim(tenant_id)) > 0),
  owner_namespace text NOT NULL CHECK (owner_namespace ~ '^[A-Za-z0-9._/-]+$'),
  package_id text NOT NULL CHECK (length(trim(package_id)) > 0),
  channel text CHECK (channel IS NULL OR channel ~ '^[A-Za-z0-9._/-]+$'),
  action text NOT NULL CHECK (action IN ('submit', 'verify', 'publish', 'rollback', 'reject')),
  actor_ref text NOT NULL CHECK (length(trim(actor_ref)) > 0),
  reason text NOT NULL CHECK (length(trim(reason)) > 0),
  from_release_ref text CHECK (from_release_ref IS NULL OR from_release_ref LIKE 'release://%'),
  to_release_ref text CHECK (to_release_ref IS NULL OR to_release_ref LIKE 'release://%'),
  release_digest text CHECK (release_digest IS NULL OR release_digest ~ '^sha256:[a-f0-9]{64}$'),
  policy_digest text CHECK (policy_digest IS NULL OR policy_digest ~ '^sha256:[a-f0-9]{64}$'),
  signature_digest text CHECK (signature_digest IS NULL OR signature_digest ~ '^sha256:[a-f0-9]{64}$'),
  result text NOT NULL CHECK (result IN ('accepted', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, audit_id)
);

DROP TRIGGER IF EXISTS agent_release_audit_append_only ON agent_release_audit;
CREATE TRIGGER agent_release_audit_append_only
BEFORE UPDATE OR DELETE ON agent_release_audit
FOR EACH ROW EXECUTE FUNCTION sage_agent_release_immutable_guard();

CREATE INDEX IF NOT EXISTS agent_package_releases_scope_idx
  ON agent_package_releases (tenant_id, owner_namespace, package_id, package_version);
CREATE INDEX IF NOT EXISTS agent_release_attestations_digest_idx
  ON agent_release_attestations (tenant_id, attestation_digest);
CREATE INDEX IF NOT EXISTS agent_release_audit_scope_idx
  ON agent_release_audit (tenant_id, owner_namespace, package_id, audit_id);

COMMIT;
