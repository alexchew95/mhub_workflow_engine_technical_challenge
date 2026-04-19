-- Demo domain data for local testing (projects, units, agents, bookings).
-- Not required for the workflow engine itself; supports integration / manual QA.

CREATE TABLE project (
  id          BIGSERIAL PRIMARY KEY,
  name        VARCHAR(200) NOT NULL,
  code        VARCHAR(50) NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE agent (
  id          BIGSERIAL PRIMARY KEY,
  name        VARCHAR(200) NOT NULL,
  email       VARCHAR(255) NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE unit (
  id            BIGSERIAL PRIMARY KEY,
  project_id    BIGINT NOT NULL REFERENCES project (id) ON DELETE CASCADE,
  unit_number   VARCHAR(50) NOT NULL,
  status        VARCHAR(50) NOT NULL DEFAULT 'available',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, unit_number)
);

CREATE INDEX idx_unit_project ON unit (project_id);

CREATE TABLE booking (
  id            BIGSERIAL PRIMARY KEY,
  unit_id       BIGINT NOT NULL REFERENCES unit (id) ON DELETE RESTRICT,
  agent_id      BIGINT REFERENCES agent (id) ON DELETE SET NULL,
  buyer_name    VARCHAR(200),
  status        VARCHAR(50) NOT NULL DEFAULT 'pending',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_booking_unit ON booking (unit_id);
CREATE INDEX idx_booking_agent ON booking (agent_id);
