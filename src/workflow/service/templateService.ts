import type { DbClient } from "../../db/pool.js";
import { pool, withTransaction } from "../../db/pool.js";
import { AppError } from "../errors.js";

export type StepInput = {
  sequence: number;
  approverKind: "USER" | "ROLE";
  userId?: number | null;
  roleId?: number | null;
};

async function assertNoRunningInstances(
  client: DbClient,
  templateId: number
): Promise<void> {
  const { rows } = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM workflow_instance
       WHERE template_id = $1 AND status IN ('pending', 'in_progress')
     ) AS exists`,
    [templateId]
  );
  if (rows[0]?.exists) {
    throw new AppError(
      "TEMPLATE_HAS_RUNNING_INSTANCES",
      "Cannot change this template while instances are pending or in progress",
      409
    );
  }
}

async function insertSteps(
  client: DbClient,
  templateId: number,
  steps: StepInput[]
): Promise<void> {
  const sorted = [...steps].sort((a, b) => a.sequence - b.sequence);
  for (const s of sorted) {
    if (s.approverKind === "USER" && (s.userId == null || s.roleId != null)) {
      throw new AppError("VALIDATION_ERROR", "USER step requires userId", 400);
    }
    if (s.approverKind === "ROLE" && (s.roleId == null || s.userId != null)) {
      throw new AppError("VALIDATION_ERROR", "ROLE step requires roleId", 400);
    }
    await client.query(
      `INSERT INTO workflow_template_step
        (template_id, sequence, approver_kind, user_id, role_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        templateId,
        s.sequence,
        s.approverKind,
        s.approverKind === "USER" ? s.userId : null,
        s.approverKind === "ROLE" ? s.roleId : null,
      ]
    );
  }
}

export async function createTemplate(input: {
  name: string;
  description: string | null;
  eventCode: string;
  steps: StepInput[];
  activate: boolean;
}): Promise<{ id: number }> {
  return withTransaction(async (client) => {
    const ev = await client.query<{ id: number }>(
      `SELECT id FROM workflow_event WHERE code = $1`,
      [input.eventCode]
    );
    if (ev.rows.length === 0) {
      throw new AppError("NOT_FOUND", `Unknown event code: ${input.eventCode}`, 404);
    }
    const eventId = ev.rows[0].id;

    if (input.steps.length === 0) {
      throw new AppError("VALIDATION_ERROR", "At least one approval step is required", 400);
    }

    if (input.activate) {
      const clash = await client.query(
        `SELECT id FROM workflow_template
         WHERE event_id = $1 AND is_active = TRUE AND status = 'PUBLISHED'`,
        [eventId]
      );
      if (clash.rows.length > 0) {
        throw new AppError(
          "TEMPLATE_EVENT_CONFLICT",
          "This trigger event already has an active published template",
          409,
          { existingTemplateId: clash.rows[0].id }
        );
      }
    }

    const status = input.activate ? "PUBLISHED" : "DRAFT";
    const isActive = input.activate;

    const ins = await client.query<{ id: number }>(
      `INSERT INTO workflow_template (name, description, event_id, version, status, is_active)
       VALUES ($1, $2, $3, 1, $4::varchar, $5)
       RETURNING id`,
      [input.name, input.description, eventId, status, isActive]
    );
    const templateId = ins.rows[0].id;
    await insertSteps(client, templateId, input.steps);
    return { id: templateId };
  });
}

export async function getTemplateDetail(templateId: number) {
  const t = await pool.query(
    `SELECT t.id, t.name, t.description, t.event_id, t.version, t.status, t.is_active,
            t.created_at, t.updated_at, e.code AS event_code
     FROM workflow_template t
     JOIN workflow_event e ON e.id = t.event_id
     WHERE t.id = $1`,
    [templateId]
  );
  if (t.rows.length === 0) {
    throw new AppError("NOT_FOUND", "Template not found", 404);
  }
  const s = await pool.query(
    `SELECT id, sequence, approver_kind, user_id, role_id, created_at, updated_at
     FROM workflow_template_step WHERE template_id = $1 ORDER BY sequence ASC`,
    [templateId]
  );
  return { template: t.rows[0], steps: s.rows };
}

export async function updateTemplate(
  templateId: number,
  input: { name?: string; description?: string | null; steps?: StepInput[] }
): Promise<void> {
  await withTransaction(async (client) => {
    const exists = await client.query(`SELECT id FROM workflow_template WHERE id = $1`, [
      templateId,
    ]);
    if (exists.rows.length === 0) {
      throw new AppError("NOT_FOUND", "Template not found", 404);
    }
    await assertNoRunningInstances(client, templateId);

    if (input.name != null || input.description !== undefined) {
      const cur = await client.query<{ name: string; description: string | null }>(
        `SELECT name, description FROM workflow_template WHERE id = $1`,
        [templateId]
      );
      const name = input.name ?? cur.rows[0].name;
      const description =
        input.description !== undefined ? input.description : cur.rows[0].description;
      await client.query(
        `UPDATE workflow_template SET name = $2, description = $3, updated_at = NOW() WHERE id = $1`,
        [templateId, name, description]
      );
    }

    if (input.steps) {
      await client.query(`DELETE FROM workflow_template_step WHERE template_id = $1`, [
        templateId,
      ]);
      await insertSteps(client, templateId, input.steps);
      await client.query(`UPDATE workflow_template SET updated_at = NOW() WHERE id = $1`, [
        templateId,
      ]);
    }
  });
}

export async function setTemplateActivation(
  templateId: number,
  active: boolean
): Promise<void> {
  await withTransaction(async (client) => {
    const cur = await client.query<{
      id: number;
      event_id: number;
      status: string;
    }>(`SELECT id, event_id, status FROM workflow_template WHERE id = $1`, [templateId]);
    if (cur.rows.length === 0) {
      throw new AppError("NOT_FOUND", "Template not found", 404);
    }
    const row = cur.rows[0];

    if (active) {
      if (row.status !== "PUBLISHED") {
        await client.query(
          `UPDATE workflow_template SET status = 'PUBLISHED', updated_at = NOW() WHERE id = $1`,
          [templateId]
        );
      }
      const clash = await client.query(
        `SELECT id FROM workflow_template
         WHERE event_id = $1 AND is_active = TRUE AND status = 'PUBLISHED' AND id <> $2`,
        [row.event_id, templateId]
      );
      if (clash.rows.length > 0) {
        throw new AppError(
          "TEMPLATE_EVENT_CONFLICT",
          "Another active published template already uses this trigger event",
          409,
          { existingTemplateId: clash.rows[0].id }
        );
      }
      await client.query(
        `UPDATE workflow_template SET is_active = TRUE, updated_at = NOW() WHERE id = $1`,
        [templateId]
      );
    } else {
      await client.query(
        `UPDATE workflow_template SET is_active = FALSE, updated_at = NOW() WHERE id = $1`,
        [templateId]
      );
    }
  });
}
