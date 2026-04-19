/**
 * Category: No transaction wrapping across multiple queries
 *
 * Problem: approval UPDATE + next-step UPDATE + instance UPDATE are separate round-trips. If the
 * process crashes after the first write, the workflow can be left inconsistent (e.g. step
 * approved but instance not advanced, or next step not opened).
 *
 * Fix: acquire a connection from the pool, run BEGIN, perform all reads/writes for this operation,
 * then COMMIT. On any validation failure before commit, ROLLBACK and return the HTTP response.
 * On thrown errors, ROLLBACK in catch, then rethrow or map to 500. Always release() in finally.
 *
 * Note: post-approval domain callbacks should run after COMMIT (outside this block), so side
 * effects are not rolled back with the SQL work.
 *
 * Requires: db.connect() (e.g. node-pg Pool).
 */
