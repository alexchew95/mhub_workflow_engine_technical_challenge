/**
 * Category: Missing authorisation — should any user be able to approve any step?
 *
 * Problem: trusting `user_id` from the body lets a caller approve as anyone, and does not enforce
 *          that the actor is actually the assignee (direct user) or a member of the assignee role.
 *
 * Fix:
 * - For USER steps: require body user_id to match the step's assigned user_id.
 * - For ROLE steps: require a row in user_roles (or equivalent) linking user_id to step.role_id.
 * - Return 403 when not an assignee (do not leak whether the step exists — optional hardening).
 *
 * Assumes columns: approver_kind, user_id, role_id on workflow_instance_steps, and table user_roles(user_id, role_id).
 *
 * Prior fixes: parameterized SQL; status check; lock_version race handling.
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

  const s = step[0];
  if (s.approver_kind === 'USER') {
    if (String(s.user_id) !== String(user_id)) {
      return res.status(403).send({ error: 'You are not assigned to approve this step' });
    }
  } else if (s.approver_kind === 'ROLE') {
    const membership = await db.query(
      `SELECT 1 FROM user_roles WHERE user_id = $1 AND role_id = $2 LIMIT 1`,
      [user_id, s.role_id]
    );
    if (membership.rowCount === 0) {
      return res.status(403).send({ error: 'You are not assigned to approve this step' });
    }
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
