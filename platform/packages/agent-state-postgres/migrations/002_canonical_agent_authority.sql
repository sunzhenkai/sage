BEGIN;

CREATE TABLE IF NOT EXISTS agent_task_specs (
  tenant_id text NOT NULL,
  spec_ref text NOT NULL CHECK (spec_ref LIKE 'spec://%'),
  spec_digest text NOT NULL CHECK (spec_digest ~ '^sha256:[a-f0-9]{64}$'),
  task_id text NOT NULL,
  run_id text NOT NULL,
  attempt_id text NOT NULL,
  spec jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, spec_ref),
  UNIQUE (tenant_id, attempt_id)
);

CREATE TABLE IF NOT EXISTS agent_run_receipts (
  tenant_id text NOT NULL,
  invocation_id text NOT NULL,
  receipt_digest text NOT NULL CHECK (receipt_digest ~ '^sha256:[a-f0-9]{64}$'),
  receipt jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, invocation_id)
);

CREATE TABLE IF NOT EXISTS agent_event_writer_fences (
  tenant_id text NOT NULL,
  task_id text NOT NULL,
  run_id text NOT NULL,
  attempt_id text NOT NULL,
  owner_token text NOT NULL,
  epoch bigint NOT NULL CHECK (epoch >= 1),
  acquired_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, task_id, run_id, attempt_id)
);

CREATE TABLE IF NOT EXISTS canonical_agent_events (
  tenant_id text NOT NULL,
  task_id text NOT NULL,
  run_id text NOT NULL,
  attempt_id text NOT NULL,
  event_id text NOT NULL,
  sequence integer NOT NULL CHECK (sequence >= 1),
  event jsonb NOT NULL,
  writer_owner_token text NOT NULL,
  writer_epoch bigint NOT NULL CHECK (writer_epoch >= 1),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, task_id, run_id, attempt_id, sequence),
  UNIQUE (tenant_id, event_id)
);

CREATE TABLE IF NOT EXISTS agent_checkpoint_candidates (
  tenant_id text NOT NULL,
  candidate_digest text NOT NULL CHECK (candidate_digest ~ '^sha256:[a-f0-9]{64}$'),
  task_id text NOT NULL,
  run_id text NOT NULL,
  attempt_id text NOT NULL,
  spec_digest text NOT NULL CHECK (spec_digest ~ '^sha256:[a-f0-9]{64}$'),
  sequence integer NOT NULL CHECK (sequence >= 1),
  candidate jsonb NOT NULL,
  writer_owner_token text NOT NULL,
  writer_epoch bigint NOT NULL CHECK (writer_epoch >= 1),
  staged_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, candidate_digest),
  UNIQUE (tenant_id, task_id, run_id, attempt_id, sequence)
);

CREATE TABLE IF NOT EXISTS sealed_agent_checkpoints (
  tenant_id text NOT NULL,
  candidate_digest text NOT NULL CHECK (candidate_digest ~ '^sha256:[a-f0-9]{64}$'),
  checkpoint_ref text NOT NULL CHECK (checkpoint_ref LIKE 'checkpoint://%'),
  checkpoint jsonb NOT NULL,
  sealed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, candidate_digest),
  UNIQUE (tenant_id, checkpoint_ref),
  FOREIGN KEY (tenant_id, candidate_digest) REFERENCES agent_checkpoint_candidates (tenant_id, candidate_digest)
);

COMMIT;
