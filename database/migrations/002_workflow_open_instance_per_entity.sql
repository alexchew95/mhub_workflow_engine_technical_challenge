-- Part 2: at most one non-terminal workflow per (entity_type, entity_id)
CREATE UNIQUE INDEX uq_workflow_instance_one_open_per_entity
  ON workflow_instance (entity_type, entity_id)
  WHERE status IN ('pending', 'in_progress');
