export type WorkflowTemplateStatus = "DRAFT" | "PUBLISHED" | "RETIRED";
export type ApproverKind = "USER" | "ROLE";

export type WorkflowInstanceStatus =
  | "pending"
  | "in_progress"
  | "approved"
  | "rejected"
  | "cancelled";

export type WorkflowInstanceStepStatus =
  | "pending"
  | "awaiting_action"
  | "approved"
  | "rejected";

export type WorkflowInstanceDecision = "approve" | "reject";

export interface WorkflowEvent {
  id: number;
  code: string;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkflowTemplate {
  id: number;
  name: string;
  description: string | null;
  eventId: number;
  version: number;
  status: WorkflowTemplateStatus;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkflowTemplateStep {
  id: number;
  templateId: number;
  sequence: number;
  approverKind: ApproverKind;
  userId: number | null;
  roleId: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkflowInstance {
  id: number;
  templateId: number;
  templateVersion: number;
  eventId: number;
  entityType: string;
  entityId: string;
  initiatedBy: number;
  status: WorkflowInstanceStatus;
  currentStepSequence: number | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

export interface WorkflowInstanceStep {
  id: number;
  instanceId: number;
  sequence: number;
  approverKind: ApproverKind;
  userId: number | null;
  roleId: number | null;
  status: WorkflowInstanceStepStatus;
  lockVersion: number;
  startedAt: Date | null;
  completedAt: Date | null;
}

export interface WorkflowInstanceAction {
  id: number;
  instanceStepId: number;
  actorUserId: number;
  decision: WorkflowInstanceDecision;
  comment: string | null;
  actedAt: Date;
}
