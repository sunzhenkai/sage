BEGIN;

CREATE TABLE IF NOT EXISTS agent_contexts (
  tenant_id text NOT NULL,
  context_id text NOT NULL,
  revision integer NOT NULL CHECK (revision >= 0),
  state jsonb NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, context_id)
);

CREATE TABLE IF NOT EXISTS agent_sessions (
  tenant_id text NOT NULL,
  session_id text NOT NULL,
  context_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('open', 'closed')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, session_id),
  FOREIGN KEY (tenant_id, context_id) REFERENCES agent_contexts (tenant_id, context_id)
);

CREATE TABLE IF NOT EXISTS agent_runs (
  tenant_id text NOT NULL,
  run_id text NOT NULL,
  session_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('running', 'paused', 'succeeded', 'failed')),
  correlation jsonb NOT NULL,
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  PRIMARY KEY (tenant_id, run_id),
  FOREIGN KEY (tenant_id, session_id) REFERENCES agent_sessions (tenant_id, session_id)
);

CREATE TABLE IF NOT EXISTS agent_checkpoints (
  tenant_id text NOT NULL,
  checkpoint_ref text NOT NULL CHECK (checkpoint_ref LIKE 'checkpoint://%'),
  run_id text NOT NULL,
  sequence integer NOT NULL CHECK (sequence >= 0),
  state jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, checkpoint_ref),
  UNIQUE (tenant_id, run_id, sequence),
  FOREIGN KEY (tenant_id, run_id) REFERENCES agent_runs (tenant_id, run_id)
);

CREATE TABLE IF NOT EXISTS agent_events (
  tenant_id text NOT NULL,
  run_id text NOT NULL,
  sequence integer NOT NULL CHECK (sequence >= 1),
  type text NOT NULL,
  payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, run_id, sequence),
  FOREIGN KEY (tenant_id, run_id) REFERENCES agent_runs (tenant_id, run_id)
);

CREATE INDEX IF NOT EXISTS agent_events_run_time_idx ON agent_events (tenant_id, run_id, occurred_at);

CREATE TABLE IF NOT EXISTS tool_idempotency (
  key_hash text PRIMARY KEY,
  owner_token text NOT NULL,
  status text NOT NULL CHECK (status IN ('claimed', 'completed')),
  lease_expires_at timestamptz,
  result jsonb,
  updated_at timestamptz NOT NULL,
  CHECK ((status = 'claimed' AND lease_expires_at IS NOT NULL AND result IS NULL)
      OR (status = 'completed' AND lease_expires_at IS NULL AND result IS NOT NULL))
);

COMMIT;
