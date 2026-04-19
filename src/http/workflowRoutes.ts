import type { FastifyInstance } from "fastify";
import { AppError } from "../workflow/errors.js";
import * as templateService from "../workflow/service/templateService.js";
import * as instanceService from "../workflow/service/instanceService.js";
import {
  mapInstanceDetail,
  mapTemplateRow,
  mapTemplateStepRow,
  toIso,
} from "./serialize.js";

function parseSteps(body: unknown): templateService.StepInput[] {
  if (!body || typeof body !== "object") return [];
  const steps = (body as { steps?: unknown }).steps;
  if (!Array.isArray(steps)) return [];
  return steps.map((s) => {
    const o = s as Record<string, unknown>;
    return {
      sequence: Number(o.sequence),
      approverKind: o.approverKind as "USER" | "ROLE",
      userId: o.userId != null ? Number(o.userId) : undefined,
      roleId: o.roleId != null ? Number(o.roleId) : undefined,
    };
  });
}

function parseRoleIds(q: string | string[] | undefined): number[] {
  if (q == null) return [];
  if (Array.isArray(q)) return q.map((x) => Number(x)).filter((n) => !Number.isNaN(n));
  return q
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
    .filter((n) => !Number.isNaN(n));
}

export async function registerWorkflowRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: Record<string, unknown> }>(
    "/api/v1/workflow/templates",
    async (req, reply) => {
      const b = req.body ?? {};
      const name = String(b.name ?? "").trim();
      const eventCode = String(b.eventCode ?? "").trim();
      if (!name || !eventCode) {
        throw new AppError("VALIDATION_ERROR", "name and eventCode are required", 400);
      }
      const steps = parseSteps({ steps: b.steps });
      const result = await templateService.createTemplate({
        name,
        description: b.description != null ? String(b.description) : null,
        eventCode,
        steps,
        activate: Boolean(b.activate),
      });
      return reply.status(201).send({ id: result.id });
    }
  );

  app.get<{ Params: { templateId: string } }>(
    "/api/v1/workflow/templates/:templateId",
    async (req, reply) => {
      const templateId = Number(req.params.templateId);
      const detail = await templateService.getTemplateDetail(templateId);
      return reply.send({
        template: mapTemplateRow({
          ...detail.template,
          event_code: detail.template.event_code,
        }),
        steps: detail.steps.map((s) => mapTemplateStepRow(s)),
      });
    }
  );

  app.patch<{ Params: { templateId: string }; Body: Record<string, unknown> }>(
    "/api/v1/workflow/templates/:templateId",
    async (req, reply) => {
      const templateId = Number(req.params.templateId);
      const b = req.body ?? {};
      const steps = b.steps !== undefined ? parseSteps({ steps: b.steps }) : undefined;
      await templateService.updateTemplate(templateId, {
        name: b.name !== undefined ? String(b.name) : undefined,
        description:
          b.description === null ? null : b.description !== undefined ? String(b.description) : undefined,
        steps,
      });
      return reply.status(204).send();
    }
  );

  app.post<{ Params: { templateId: string }; Body: Record<string, unknown> }>(
    "/api/v1/workflow/templates/:templateId/activation",
    async (req, reply) => {
      const templateId = Number(req.params.templateId);
      const active = Boolean((req.body as { active?: boolean })?.active);
      await templateService.setTemplateActivation(templateId, active);
      return reply.status(204).send();
    }
  );

  app.post<{ Body: Record<string, unknown> }>(
    "/api/v1/workflow/instances",
    async (req, reply) => {
      const b = req.body ?? {};
      const result = await instanceService.triggerInstance({
        eventCode: String(b.eventCode ?? ""),
        entityType: String(b.entityType ?? ""),
        entityId: String(b.entityId ?? ""),
        initiatedBy: Number(b.initiatedBy),
      });
      return reply.status(201).send({ instanceId: result.instanceId });
    }
  );

  app.get<{ Params: { instanceId: string } }>(
    "/api/v1/workflow/instances/:instanceId",
    async (req, reply) => {
      const instanceId = Number(req.params.instanceId);
      const raw = await instanceService.getInstanceDetail(instanceId);
      return reply.send(mapInstanceDetail(raw as Parameters<typeof mapInstanceDetail>[0]));
    }
  );

  app.get<{ Querystring: { userId?: string; roleIds?: string | string[] } }>(
    "/api/v1/workflow/inbox",
    async (req, reply) => {
      const userId = Number(req.query.userId);
      if (Number.isNaN(userId)) {
        throw new AppError("VALIDATION_ERROR", "Query userId is required", 400);
      }
      const roleIds = parseRoleIds(req.query.roleIds);
      const rows = await instanceService.listInbox({ userId, roleIds });
      return reply.send({
        items: rows.map((r) => ({
          stepId: Number(r.id),
          instanceId: Number(r.instance_id),
          sequence: Number(r.sequence),
          approverKind: r.approver_kind,
          userId: r.user_id != null ? Number(r.user_id) : null,
          roleId: r.role_id != null ? Number(r.role_id) : null,
          status: r.status,
          lockVersion: Number(r.lock_version),
          startedAt: toIso(r.started_at as Date | null),
          entityType: r.entity_type,
          entityId: String(r.entity_id),
          initiatedBy: Number(r.initiated_by),
          instanceStatus: r.instance_status,
          eventCode: r.event_code,
        })),
      });
    }
  );

  app.post<{ Params: { stepId: string }; Body: Record<string, unknown> }>(
    "/api/v1/workflow/instance-steps/:stepId/approve",
    async (req, reply) => {
      const stepId = Number(req.params.stepId);
      const b = req.body ?? {};
      const roleIds = Array.isArray(b.roleIds)
        ? (b.roleIds as unknown[]).map(Number)
        : parseRoleIds(b.roleIds != null ? String(b.roleIds) : undefined);
      await instanceService.approveStep({
        stepId,
        actorUserId: Number(b.actorUserId),
        actorRoleIds: roleIds,
        comment: b.comment != null ? String(b.comment) : null,
        lockVersion: Number(b.lockVersion),
      });
      return reply.status(204).send();
    }
  );

  app.post<{ Params: { stepId: string }; Body: Record<string, unknown> }>(
    "/api/v1/workflow/instance-steps/:stepId/reject",
    async (req, reply) => {
      const stepId = Number(req.params.stepId);
      const b = req.body ?? {};
      const roleIds = Array.isArray(b.roleIds)
        ? (b.roleIds as unknown[]).map(Number)
        : parseRoleIds(b.roleIds != null ? String(b.roleIds) : undefined);
      await instanceService.rejectStep({
        stepId,
        actorUserId: Number(b.actorUserId),
        actorRoleIds: roleIds,
        comment: String(b.comment ?? ""),
        lockVersion: Number(b.lockVersion),
      });
      return reply.status(204).send();
    }
  );
}
