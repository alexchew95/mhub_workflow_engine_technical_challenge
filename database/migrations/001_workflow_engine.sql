-- Part 1 — Workflow engine: template configuration + runtime + audit
-- PostgreSQL

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

CREATE UNIQUE INDEX uq_workflow_template_one_active_per_event
  ON workflow_template (event_id)
  WHERE is_active = TRUE AND status = 'PUBLISHED';

CREATE TABLE workflow_template_step (
  id             BIGSERIAL PRIMARY KEY,
  template_id    BIGINT NOT NULL REFERENCES workflow_template (id) ON DELETE CASCADE,
  sequence       INT NOT NULL CHECK (sequence >= 1),
  approver_kind  VARCHAR(10) NOT NULL CHECK (approver_kind IN ('USER', 'ROLE')),
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

CREATE TABLE workflow_instance (
  id                    BIGSERIAL PRIMARY KEY,
  template_id           BIGINT NOT NULL REFERENCES workflow_template (id) ON DELETE RESTRICT,
  template_version      INT NOT NULL,
  event_id              BIGINT NOT NULL REFERENCES workflow_event (id) ON DELETE RESTRICT,
  entity_type           VARCHAR(100) NOT NULL,
  entity_id             VARCHAR(100) NOT NULL,
  initiated_by          BIGINT NOT NULL,
  status                VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'approved', 'rejected', 'cancelled')),
  current_step_sequence INT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at          TIMESTAMPTZ NULL
);

CREATE TABLE workflow_instance_step (
  id              BIGSERIAL PRIMARY KEY,
  instance_id     BIGINT NOT NULL REFERENCES workflow_instance (id) ON DELETE CASCADE,
  sequence        INT NOT NULL CHECK (sequence >= 1),
  approver_kind   VARCHAR(10) NOT NULL CHECK (approver_kind IN ('USER', 'ROLE')),
  user_id         BIGINT NULL,
  role_id         BIGINT NULL,
  status          VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'awaiting_action', 'approved', 'rejected')),
  lock_version    INT NOT NULL DEFAULT 1,
  started_at      TIMESTAMPTZ NULL,
  completed_at    TIMESTAMPTZ NULL,
  UNIQUE (instance_id, sequence),
  CHECK (
    (approver_kind = 'USER' AND user_id IS NOT NULL AND role_id IS NULL)
    OR (approver_kind = 'ROLE' AND role_id IS NOT NULL AND user_id IS NULL)
  )
);

CREATE TABLE workflow_instance_action (
  id                 BIGSERIAL PRIMARY KEY,
  instance_step_id   BIGINT NOT NULL REFERENCES workflow_instance_step (id) ON DELETE CASCADE,
  actor_user_id      BIGINT NOT NULL,
  decision           VARCHAR(20) NOT NULL CHECK (decision IN ('approve', 'reject')),
  comment            TEXT NULL,
  acted_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_workflow_instance_entity
  ON workflow_instance (entity_type, entity_id);

CREATE INDEX idx_workflow_instance_initiator
  ON workflow_instance (initiated_by);

CREATE INDEX idx_workflow_instance_status
  ON workflow_instance (status);

CREATE INDEX idx_workflow_instance_template
  ON workflow_instance (template_id);

CREATE INDEX idx_workflow_instance_step_instance
  ON workflow_instance_step (instance_id);

CREATE INDEX idx_workflow_instance_step_pending_user
  ON workflow_instance_step (user_id)
  WHERE status = 'awaiting_action' AND approver_kind = 'USER';

CREATE INDEX idx_workflow_instance_step_pending_role
  ON workflow_instance_step (role_id)
  WHERE status = 'awaiting_action' AND approver_kind = 'ROLE';

CREATE INDEX idx_workflow_instance_step_pending_status
  ON workflow_instance_step (status, instance_id);

CREATE INDEX idx_workflow_instance_action_step
  ON workflow_instance_action (instance_step_id);

CREATE INDEX idx_workflow_instance_action_actor
  ON workflow_instance_action (actor_user_id);
