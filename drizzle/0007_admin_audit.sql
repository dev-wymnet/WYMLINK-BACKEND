-- Extend sessions with session_type and revoked
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS session_type text NOT NULL DEFAULT 'customer';
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS revoked boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS sessions_type_idx ON sessions(session_type);
CREATE INDEX IF NOT EXISTS sessions_revoked_idx ON sessions(revoked);

-- Create audit_logs
CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_admin_id uuid NULL,
  actor_role text NULL,
  action text NOT NULL,
  target_type text NULL,
  target_id text NULL,
  ip text NULL,
  user_agent text NULL,
  success boolean NOT NULL DEFAULT true,
  reason text NULL,
  before jsonb NULL,
  after jsonb NULL,
  request_id text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_logs_action_idx ON audit_logs(action);
CREATE INDEX IF NOT EXISTS audit_logs_actor_idx ON audit_logs(actor_admin_id);
CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON audit_logs(created_at);
