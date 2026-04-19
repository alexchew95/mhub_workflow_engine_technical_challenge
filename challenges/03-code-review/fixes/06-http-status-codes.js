/**
 * Category: Incorrect or missing HTTP status codes
 *
 * Problems:
 * - Success path used res.send() without explicit 2xx (implicit 200 is easy to miss in review).
 * - Errors mixed 200 + { error } (original sample), or used 409 for both "wrong state" and "lost lock".
 *
 * Fixes applied in flawed-approve-handler.js:
 * - 200 + explicit .send({ success: true }) on successful approval.
 * - 400 for malformed / unparseable input.
 * - 404 when step missing or not under this instance.
 * - 422 when the step exists but cannot be approved in current state (not awaiting_action), or invalid approver_kind.
 * - 409 reserved for optimistic-lock conflict only (concurrent update).
 * - 403 for not assignee.
 * - 500 for unexpected errors.
 *
 * Note: Some teams use 409 for both stale state and lock conflict; splitting 422 vs 409 here makes
 * "wrong workflow state" vs "lost race" easier to handle in the client.
 */
