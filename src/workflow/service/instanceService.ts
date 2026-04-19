import { pool, withTransaction } from "../../db/pool.js";
import { AppError } from "../errors.js";
import {
  dispatchFinalApproval,
  dispatchRejected,
  type InstanceCompletedPayload,
} from "../callbacks.js";

export async function triggerInstance(input: {
  eventCode: string;
  entityType: string;
  entityId: string;
  initiatedBy: number;
}): Promise<{ instanceId: number }> {
  return withTransaction(async (client) => {
    const ev = await client.query<{ id: number }>(
      `SELECT id FROM workflow_event WHERE code = $1`,
      [input.eventCode]
    );
    if (ev.rows.length === 0) {
      throw new AppError("NOT_FOUND", `Unknown event code: ${input.eventCode}`, 404);
    }
    const eventId = ev.rows[0].id;

    const tpl = await client.query<{
      id: number;
      version: number;
    }>(
      `SELECT id, version FROM workflow_template
       WHERE event_id = $1 AND is_active = TRUE AND status = 'PUBLISHED'
       LIMIT 1`,
      [eventId]
    );
    if (tpl.rows.length === 0) {
      throw new AppError(
        "NO_ACTIVE_TEMPLATE",
        "No active published workflow template is bound to this event",
        404
      );
    }
    const t = tpl.rows[0];

    const steps = await client.query<{
      sequence: number;
      approver_kind: string;
      user_id: bigint | null;
      role_id: bigint | null;
    }>(
      `SELECT sequence, approver_kind, user_id, role_id
       FROM workflow_template_step WHERE template_id = $1 ORDER BY sequence ASC`,
      [t.id]
    );
    if (steps.rows.length === 0) {
      throw new AppError("VALIDATION_ERROR", "Template has no steps", 400);
    }

    let instanceId: number;
    try {
      const ins = await client.query<{ id: number }>(
        `INSERT INTO workflow_instance
          (template_id, template_version, event_id, entity_type, entity_id, initiated_by, status, current_step_sequence)
         VALUES ($1, $2, $3, $4, $5, $6, 'in_progress', $7)
         RETURNING id`,
        [
          t.id,
          t.version,
          eventId,
          input.entityType,
          input.entityId,
          input.initiatedBy,
          steps.rows[0].sequence,
        ]
      );
      instanceId = ins.rows[0].id;
    } catch (e: unknown) {
      const err = e as { code?: string };
      if (err.code === "23505") {
        const existing = await client.query<{ id: number }>(
          `SELECT id FROM workflow_instance
           WHERE entity_type = $1 AND entity_id = $2 AND status IN ('pending', 'in_progress')`,
          [input.entityType, input.entityId]
        );
        throw new AppError(
          "INSTANCE_ENTITY_CONFLICT",
          "An open workflow instance already exists for this entity",
          409,
          { existingInstanceId: existing.rows[0]?.id }
        );
      }
      throw e;
    }

    for (const row of steps.rows) {
      const st =
        row.sequence === steps.rows[0].sequence ? "awaiting_action" : "pending";
      const started = row.sequence === steps.rows[0].sequence ? new Date() : null;
      await client.query(
        `INSERT INTO workflow_instance_step
          (instance_id, sequence, approver_kind, user_id, role_id, status, started_at, lock_version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 1)`,
        [
          instanceId,
          row.sequence,
          row.approver_kind,
          row.user_id,
          row.role_id,
          st,
          started,
        ]
      );
    }

    return { instanceId };
  });
}

export async function getInstanceDetail(instanceId: number) {
  const i = await pool.query(
    `SELECT wi.id, wi.template_id, wi.template_version, wi.event_id, wi.entity_type, wi.entity_id,
            wi.initiated_by, wi.status, wi.current_step_sequence, wi.created_at, wi.updated_at, wi.completed_at,
            we.code AS event_code
     FROM workflow_instance wi
     JOIN workflow_event we ON we.id = wi.event_id
     WHERE wi.id = $1`,
    [instanceId]
  );
  if (i.rows.length === 0) {
    throw new AppError("NOT_FOUND", "Instance not found", 404);
  }

  const steps = await pool.query(
    `SELECT id, instance_id, sequence, approver_kind, user_id, role_id, status, lock_version,
            started_at, completed_at
     FROM workflow_instance_step WHERE instance_id = $1 ORDER BY sequence ASC`,
    [instanceId]
  );

  const stepIds = steps.rows.map((r) => r.id);
  let actions: { rows: Record<string, unknown>[] } = { rows: [] };
  if (stepIds.length > 0) {
    actions = await pool.query(
      `SELECT id, instance_step_id, actor_user_id, decision, comment, acted_at
       FROM workflow_instance_action WHERE instance_step_id = ANY($1::bigint[])
       ORDER BY acted_at ASC`,
      [stepIds]
    );
  }

  const byStep = new Map<number, typeof actions.rows>();
  for (const a of actions.rows) {
    const sid = Number(a.instance_step_id);
    const list = byStep.get(sid) ?? [];
    list.push(a);
    byStep.set(sid, list);
  }

  return {
    instance: i.rows[0],
    steps: steps.rows.map((s) => ({
      ...s,
      actions: byStep.get(Number(s.id)) ?? [],
    })),
  };
}

function isAssignee(
  step: {
    approver_kind: string;
    user_id: bigint | null;
    role_id: bigint | null;
  },
  actorUserId: number,
  actorRoleIds: Set<number>
): boolean {
  if (step.approver_kind === "USER") {
    return Number(step.user_id) === actorUserId;
  }
  return step.role_id != null && actorRoleIds.has(Number(step.role_id));
}

export async function approveStep(input: {
  stepId: number;
  actorUserId: number;
  actorRoleIds: number[];
  comment: string | null;
  lockVersion: number;
}): Promise<void> {
  const roles = new Set(input.actorRoleIds);
  let completionPayload: InstanceCompletedPayload | null = null;

  await withTransaction(async (client) => {
    const step = await client.query<{
      id: number;
      instance_id: number;
      sequence: number;
      status: string;
      lock_version: number;
      approver_kind: string;
      user_id: bigint | null;
      role_id: bigint | null;
    }>(
      `SELECT wis.id, wis.instance_id, wis.sequence, wis.status, wis.lock_version,
              wis.approver_kind, wis.user_id, wis.role_id
       FROM workflow_instance_step wis
       WHERE wis.id = $1`,
      [input.stepId]
    );
    if (step.rows.length === 0) {
      throw new AppError("NOT_FOUND", "Step not found", 404);
    }
    const s = step.rows[0];

    if (s.status !== "awaiting_action") {
      throw new AppError(
        "STEP_NOT_AWAITING",
        "This step is not awaiting action",
        409,
        { status: s.status }
      );
    }

    if (!isAssignee(s, input.actorUserId, roles)) {
      throw new AppError(
        "FORBIDDEN_NOT_ASSIGNEE",
        "You are not an assignee for this step",
        403
      );
    }

    const upd = await client.query(
      `UPDATE workflow_instance_step
       SET status = 'approved',
           completed_at = NOW(),
           lock_version = lock_version + 1
       WHERE id = $1 AND status = 'awaiting_action' AND lock_version = $2`,
      [input.stepId, input.lockVersion]
    );
    if (upd.rowCount === 0) {
      throw new AppError(
        "STEP_CONCURRENCY_CONFLICT",
        "Another approver already completed this step. Refresh and try again.",
        409
      );
    }

    await client.query(
      `INSERT INTO workflow_instance_action (instance_step_id, actor_user_id, decision, comment)
       VALUES ($1, $2, 'approve', $3)`,
      [input.stepId, input.actorUserId, input.comment]
    );

    const maxSeq = await client.query<{ m: string }>(
      `SELECT MAX(sequence)::text AS m FROM workflow_instance_step WHERE instance_id = $1`,
      [s.instance_id]
    );
    const lastSeq = Number(maxSeq.rows[0]?.m ?? 0);

    if (s.sequence >= lastSeq) {
      await client.query(
        `UPDATE workflow_instance SET status = 'approved', completed_at = NOW(), updated_at = NOW(), current_step_sequence = $2
         WHERE id = $1`,
        [s.instance_id, s.sequence]
      );

      const meta = await client.query<{
        event_code: string;
        entity_type: string;
        entity_id: string;
        initiated_by: number;
      }>(
        `SELECT we.code AS event_code, wi.entity_type, wi.entity_id, wi.initiated_by
         FROM workflow_instance wi
         JOIN workflow_event we ON we.id = wi.event_id
         WHERE wi.id = $1`,
        [s.instance_id]
      );
      const m = meta.rows[0];
      completionPayload = {
        instanceId: s.instance_id,
        eventCode: m.event_code,
        entityType: m.entity_type,
        entityId: m.entity_id,
        outcome: "approved",
        initiatedBy: Number(m.initiated_by),
      };
    } else {
      const next = await client.query<{ id: number; sequence: number }>(
        `SELECT id, sequence FROM workflow_instance_step
         WHERE instance_id = $1 AND sequence = $2`,
        [s.instance_id, s.sequence + 1]
      );
      if (next.rows.length === 0) {
        throw new AppError("VALIDATION_ERROR", "Next step missing", 500);
      }
      await client.query(
        `UPDATE workflow_instance_step SET status = 'awaiting_action', started_at = NOW(), lock_version = 1
         WHERE id = $1`,
        [next.rows[0].id]
      );
      await client.query(
        `UPDATE workflow_instance SET current_step_sequence = $2, updated_at = NOW() WHERE id = $1`,
        [s.instance_id, next.rows[0].sequence]
      );
    }
  });

  if (completionPayload) {
    await dispatchFinalApproval(completionPayload);
  }
}

export async function rejectStep(input: {
  stepId: number;
  actorUserId: number;
  actorRoleIds: number[];
  comment: string;
  lockVersion: number;
}): Promise<void> {
  if (!input.comment.trim()) {
    throw new AppError(
      "REJECT_COMMENT_REQUIRED",
      "Rejection requires a non-empty comment",
      400
    );
  }

  const roles = new Set(input.actorRoleIds);
  let completionPayload: InstanceCompletedPayload | null = null;

  await withTransaction(async (client) => {
    const step = await client.query<{
      id: number;
      instance_id: number;
      status: string;
      lock_version: number;
      approver_kind: string;
      user_id: bigint | null;
      role_id: bigint | null;
    }>(
      `SELECT id, instance_id, status, lock_version, approver_kind, user_id, role_id
       FROM workflow_instance_step WHERE id = $1`,
      [input.stepId]
    );
    if (step.rows.length === 0) {
      throw new AppError("NOT_FOUND", "Step not found", 404);
    }
    const s = step.rows[0];

    if (s.status !== "awaiting_action") {
      throw new AppError(
        "STEP_NOT_AWAITING",
        "This step is not awaiting action",
        409,
        { status: s.status }
      );
    }

    if (!isAssignee(s, input.actorUserId, roles)) {
      throw new AppError(
        "FORBIDDEN_NOT_ASSIGNEE",
        "You are not an assignee for this step",
        403
      );
    }

    const upd = await client.query(
      `UPDATE workflow_instance_step
       SET status = 'rejected',
           completed_at = NOW(),
           lock_version = lock_version + 1
       WHERE id = $1 AND status = 'awaiting_action' AND lock_version = $2`,
      [input.stepId, input.lockVersion]
    );
    if (upd.rowCount === 0) {
      throw new AppError(
        "STEP_CONCURRENCY_CONFLICT",
        "Another approver already completed this step. Refresh and try again.",
        409
      );
    }

    await client.query(
      `INSERT INTO workflow_instance_action (instance_step_id, actor_user_id, decision, comment)
       VALUES ($1, $2, 'reject', $3)`,
      [input.stepId, input.actorUserId, input.comment]
    );

    await client.query(
      `UPDATE workflow_instance SET status = 'rejected', completed_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [s.instance_id]
    );

    const meta = await client.query<{
      event_code: string;
      entity_type: string;
      entity_id: string;
      initiated_by: number;
    }>(
      `SELECT we.code AS event_code, wi.entity_type, wi.entity_id, wi.initiated_by
       FROM workflow_instance wi
       JOIN workflow_event we ON we.id = wi.event_id
       WHERE wi.id = $1`,
      [s.instance_id]
    );
    const m = meta.rows[0];
    completionPayload = {
      instanceId: s.instance_id,
      eventCode: m.event_code,
      entityType: m.entity_type,
      entityId: m.entity_id,
      outcome: "rejected",
      initiatedBy: Number(m.initiated_by),
    };
  });

  if (completionPayload) {
    await dispatchRejected(completionPayload);
  }
}

export async function listInbox(input: {
  userId: number;
  roleIds: number[];
}) {
  const { rows } = await pool.query(
    `SELECT wis.id,
            wis.instance_id,
            wis.sequence,
            wis.approver_kind,
            wis.user_id,
            wis.role_id,
            wis.status,
            wis.lock_version,
            wis.started_at,
            wi.entity_type,
            wi.entity_id,
            wi.initiated_by,
            wi.status AS instance_status,
            we.code AS event_code
     FROM workflow_instance_step wis
     JOIN workflow_instance wi ON wi.id = wis.instance_id
     JOIN workflow_event we ON we.id = wi.event_id
     WHERE wis.status = 'awaiting_action'
       AND (
         (wis.approver_kind = 'USER' AND wis.user_id = $1)
         OR (wis.approver_kind = 'ROLE' AND wis.role_id = ANY($2::bigint[]))
       )
     ORDER BY wis.started_at ASC NULLS LAST, wis.id ASC`,
    [input.userId, input.roleIds]
  );
  return rows;
}
