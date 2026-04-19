/**
 * Domain types for §1.1 Workflow Template Configuration.
 * Aligns with database/migrations/001_workflow_template_configuration.sql
 */

export type WorkflowTemplateStatus = "DRAFT" | "PUBLISHED" | "RETIRED";

export type ApproverKind = "USER" | "ROLE";

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
  /** When true with status PUBLISHED, DB enforces one row per event_id */
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkflowTemplateStep {
  id: number;
  templateId: number;
  /** 1-based order within the template */
  sequence: number;
  approverKind: ApproverKind;
  userId: number | null;
  roleId: number | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Input shape for creating/updating template steps in admin UI */
export type WorkflowTemplateStepInput =
  | { sequence: number; approverKind: "USER"; userId: number }
  | { sequence: number; approverKind: "ROLE"; roleId: number };
