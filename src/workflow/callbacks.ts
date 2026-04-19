/**
 * Register domain callbacks from the host app (e.g. cancel booking on final approval).
 * Not invoked over HTTP — keeps the workflow module decoupled from CRM/booking code.
 */

export type InstanceCompletedPayload = {
  instanceId: number;
  eventCode: string;
  entityType: string;
  entityId: string;
  outcome: "approved" | "rejected";
  initiatedBy: number;
};

const onFinalApproval = new Map<string, (p: InstanceCompletedPayload) => Promise<void>>();
const onRejected = new Map<string, (p: InstanceCompletedPayload) => Promise<void>>();

export function registerOnFinalApproval(
  eventCode: string,
  handler: (p: InstanceCompletedPayload) => Promise<void>
): void {
  onFinalApproval.set(eventCode, handler);
}

export function registerOnRejected(
  eventCode: string,
  handler: (p: InstanceCompletedPayload) => Promise<void>
): void {
  onRejected.set(eventCode, handler);
}

export async function dispatchFinalApproval(p: InstanceCompletedPayload): Promise<void> {
  const h = onFinalApproval.get(p.eventCode);
  if (h) await h(p);
}

export async function dispatchRejected(p: InstanceCompletedPayload): Promise<void> {
  const h = onRejected.get(p.eventCode);
  if (h) await h(p);
}
