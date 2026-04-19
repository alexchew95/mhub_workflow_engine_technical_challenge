-- 1.1 Workflow Template Configuration
-- PostgreSQL: predefined events, reusable templates, ordered steps (user OR role approver).
-- One active published template per trigger event (partial unique index).

CREATE TABLE workflow_event (
  id          BIGSERIAL PRIMARY KEY,
  code        VARCHAR(100) NOT NULL UNIQUE,
  name        VARCHAR(200) NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE workflow_template (
  id          BIGSERIAL PRIMARY KEY,
  name        VARCHAR(200) NOT NULL,
  description TEXT,
  event_id    BIGINT NOT NULL REFERENCES workflow_event (id) ON DELETE RESTRICT,
  version     INT NOT NULL DEFAULT 1,
  status      VARCHAR(20) NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'PUBLISHED', 'RETIRED')),
  is_active   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (event_id, version)
);

-- At most one active, published template per event (interview requirement).
CREATE UNIQUE INDEX uq_workflow_template_one_active_per_event
  ON workflow_template (event_id)
  WHERE is_active = TRUE AND status = 'PUBLISHED';

CREATE TABLE workflow_template_step (
  id             BIGSERIAL PRIMARY KEY,
  template_id    BIGINT NOT NULL REFERENCES workflow_template (id) ON DELETE CASCADE,
  sequence       INT NOT NULL CHECK (sequence >= 1),
  approver_kind  VARCHAR(10) NOT NULL CHECK (approver_kind IN ('USER', 'ROLE')),
  -- FK to platform users / roles when those tables exist:
  -- user_id BIGINT REFERENCES users (id),
  -- role_id BIGINT REFERENCES roles (id),
  user_id        BIGINT NULL,
  role_id        BIGINT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (template_id, sequence),
  CHECK (
    (approver_kind = 'USER' AND user_id IS NOT NULL AND role_id IS NULL)
    OR (approver_kind = 'ROLE' AND role_id IS NOT NULL AND user_id IS NULL)
  )
);

CREATE INDEX idx_workflow_template_event ON workflow_template (event_id);
CREATE INDEX idx_workflow_template_step_template ON workflow_template_step (template_id);

COMMENT ON TABLE workflow_event IS 'Predefined system events; templates bind to one event.';
COMMENT ON TABLE workflow_template IS 'Reusable workflow definition (name, description, trigger event).';
COMMENT ON TABLE workflow_template_step IS 'Ordered approval steps; approver is either a user or a role.';
