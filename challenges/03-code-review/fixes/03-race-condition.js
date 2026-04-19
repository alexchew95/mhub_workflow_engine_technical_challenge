/**
 * Category: Race condition — two approvers on the same step at once
 *
 * Problem: two requests can both pass a status check, then both run UPDATE; both "succeed"
 *          or you double-advance the workflow unless the database enforces a single winner.
 *
 * Fix (optimistic concurrency):
 * - Store lock_version (or similar) on the step row; client sends the version it read.
 * - UPDATE ... WHERE id = ? AND status = 'awaiting_action' AND lock_version = ?
 *   SET ..., lock_version = lock_version + 1
 * - If rowCount === 0, another transaction won — return 409 with a clear message.
 *
 * Requires: lock_version column on workflow_instance_steps (integer, default 1).
 *
 * Prior fixes included: parameterized queries; status != 'awaiting_action' guard.
 */

app.post('/api/workflow-instances/:id/steps/:stepId/approve', async (req, res) => {
  const { id, stepId } = req.params;
  const { user_id, comment, lock_version } = req.body;

  const step = await db.query(
    `SELECT * FROM workflow_instance_steps WHERE id = $1`,
    [stepId]
  );

  if (step[0].status != 'awaiting_action') {
    return res.send({ error: 'step not actionable' });
  }

  const updated = await db.query(
    `UPDATE workflow_instance_steps SET status = 'approved', actioned_by = $1,
     comment = $2, actioned_at = NOW(), lock_version = lock_version + 1
     WHERE id = $3 AND status = 'awaiting_action' AND lock_version = $4`,
    [user_id, comment, stepId, lock_version]
  );

  if (updated.rowCount === 0) {
    return res.status(409).send({
      error: 'This step was already completed by another approver; refresh and try again.',
    });
  }

  const nextStep = await db.query(
    `SELECT * FROM workflow_instance_steps WHERE instance_id = $1
     AND sequence > $2 ORDER BY sequence ASC LIMIT 1`,
    [id, step[0].sequence]
  );

  if (nextStep.length > 0) {
    await db.query(`UPDATE workflow_instance_steps SET status = 'awaiting_action'
      WHERE id = $1`,
      [nextStep[0].id]);
  } else {
    await db.query(`UPDATE workflow_instances SET status = 'approved' WHERE id = $1`, [id]);
    // TODO: trigger post-approval callback
  }

  res.send({ success: true });
});
