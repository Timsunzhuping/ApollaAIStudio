-- 0001_init — tasks table (Task stored as JSONB + indexed owner/project columns).
CREATE TABLE IF NOT EXISTS tasks (
  id          text PRIMARY KEY,
  owner_id    text NOT NULL,
  project_id  text,
  type        text NOT NULL,
  state       text NOT NULL,
  data        jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tasks_owner_idx ON tasks (owner_id);
CREATE INDEX IF NOT EXISTS tasks_project_idx ON tasks (project_id);
