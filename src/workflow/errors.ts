export type ErrorCode =
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "TEMPLATE_EVENT_CONFLICT"
  | "NO_ACTIVE_TEMPLATE"
  | "INSTANCE_ENTITY_CONFLICT"
  | "STEP_NOT_AWAITING"
  | "STEP_CONCURRENCY_CONFLICT"
  | "TEMPLATE_HAS_RUNNING_INSTANCES"
  | "FORBIDDEN_NOT_ASSIGNEE"
  | "REJECT_COMMENT_REQUIRED";

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly httpStatus: number,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "AppError";
  }
}
