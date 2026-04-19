export function toIso(d: Date | string | null | undefined): string | null {
  if (d == null) return null;
  if (d instanceof Date) return d.toISOString();
  return new Date(d).toISOString();
}

export function mapTemplateRow(r: Record<string, unknown>) {
  return {
    id: Number(r.id),
    name: r.name,
    description: r.description,
    eventId: Number(r.event_id),
    version: Number(r.version),
    status: r.status,
    isActive: r.is_active,
    createdAt: toIso(r.created_at as Date),
    updatedAt: toIso(r.updated_at as Date),
    eventCode: r.event_code,
  };
}

export function mapTemplateStepRow(r: Record<string, unknown>) {
  return {
    id: Number(r.id),
    sequence: Number(r.sequence),
    approverKind: r.approver_kind,
    userId: r.user_id != null ? Number(r.user_id) : null,
    roleId: r.role_id != null ? Number(r.role_id) : null,
    createdAt: toIso(r.created_at as Date),
    updatedAt: toIso(r.updated_at as Date),
  };
}

export function mapInstanceDetail(data: {
  instance: Record<string, unknown>;
  steps: Array<Record<string, unknown> & { actions: Record<string, unknown>[] }>;
}) {
  const i = data.instance;
  return {
    id: Number(i.id),
    templateId: Number(i.template_id),
    templateVersion: Number(i.template_version),
    eventId: Number(i.event_id),
    eventCode: i.event_code,
    entityType: i.entity_type,
    entityId: String(i.entity_id),
    initiatedBy: Number(i.initiated_by),
    status: i.status,
    currentStepSequence:
      i.current_step_sequence != null ? Number(i.current_step_sequence) : null,
    createdAt: toIso(i.created_at as Date),
    updatedAt: toIso(i.updated_at as Date),
    completedAt: toIso(i.completed_at as Date | null),
    steps: data.steps.map((s) => ({
      id: Number(s.id),
      instanceId: Number(s.instance_id),
      sequence: Number(s.sequence),
      approverKind: s.approver_kind,
      userId: s.user_id != null ? Number(s.user_id) : null,
      roleId: s.role_id != null ? Number(s.role_id) : null,
      status: s.status,
      lockVersion: Number(s.lock_version),
      startedAt: toIso(s.started_at as Date | null),
      completedAt: toIso(s.completed_at as Date | null),
      actions: (s.actions ?? []).map((a) => ({
        id: Number(a.id),
        actorUserId: Number(a.actor_user_id),
        decision: a.decision,
        comment: a.comment,
        actedAt: toIso(a.acted_at as Date),
      })),
    })),
  };
}
