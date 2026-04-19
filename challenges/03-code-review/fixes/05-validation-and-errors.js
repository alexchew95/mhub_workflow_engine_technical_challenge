/**
 * Category: Missing input validation and error handling
 *
 * Full handler matches flawed-approve-handler.js after fixes through category 5.
 *
 * Problems addressed:
 * - Path params and body fields used without checks → NaN in SQL, crashes on step[0] when missing.
 * - No proof step belongs to the instance in the URL → cross-instance step id abuse.
 * - Wrong status returned with default 200 for errors.
 * - Unhandled exceptions from db.query → opaque failures / leaked details if mishandled.
 *
 * Fixes:
 * - Parse and validate instance id, step id, user_id, lock_version; 400 if invalid.
 * - Optional comment normalized to string or null.
 * - 404 if no step or step.instance_id does not match :id.
 * - 409 for wrong step status and for optimistic-lock conflict.
 * - try/catch: log server-side, generic 500 body (no stack trace).
 * - Unknown approver_kind → 500 invalid configuration.
 */

// POST /api/workflow-instances/:id/steps/:stepId/approve
app.post('/api/workflow-instances/:id/steps/:stepId/approve', async (req, res) => {
  try {
    const { id, stepId } = req.params;
    const { user_id, comment, lock_version } = req.body;

    const instanceId = Number.parseInt(String(id), 10);
    const stepIdNum = Number.parseInt(String(stepId), 10);
    if (Number.isNaN(instanceId) || Number.isNaN(stepIdNum)) {
      return res.status(400).send({ error: 'Invalid instance id or step id' });
    }

    const actorId = Number.parseInt(String(user_id), 10);
    const lockVer = Number.parseInt(String(lock_version), 10);
    if (Number.isNaN(actorId) || Number.isNaN(lockVer)) {
      return res.status(400).send({ error: 'user_id and lock_version must be integers' });
    }

    const commentText = comment == null || comment === '' ? null : String(comment);

    const step = await db.query(
      `SELECT * FROM workflow_instance_steps WHERE id = $1`,
      [stepIdNum]
    );

    if (!step[0] || String(step[0].instance_id) !== String(instanceId)) {
      return res.status(404).send({ error: 'Step not found' });
    }

    if (step[0].status != 'awaiting_action') {
      return res.status(409).send({ error: 'step not actionable' });
    }

    const s = step[0];
    if (s.approver_kind === 'USER') {
      if (String(s.user_id) !== String(actorId)) {
        return res.status(403).send({ error: 'You are not assigned to approve this step' });
      }
    } else if (s.approver_kind === 'ROLE') {
      const membership = await db.query(
        `SELECT 1 FROM user_roles WHERE user_id = $1 AND role_id = $2 LIMIT 1`,
        [actorId, s.role_id]
      );
      if (membership.rowCount === 0) {
        return res.status(403).send({ error: 'You are not assigned to approve this step' });
      }
    } else {
      return res.status(500).send({ error: 'Invalid step configuration' });
    }

    const updated = await db.query(
      `UPDATE workflow_instance_steps SET status = 'approved', actioned_by = $1,
       comment = $2, actioned_at = NOW(), lock_version = lock_version + 1
       WHERE id = $3 AND status = 'awaiting_action' AND lock_version = $4`,
      [actorId, commentText, stepIdNum, lockVer]
    );

    if (updated.rowCount === 0) {
      return res.status(409).send({
        error: 'This step was already completed by another approver; refresh and try again.',
      });
    }

    const nextStep = await db.query(
      `SELECT * FROM workflow_instance_steps WHERE instance_id = $1
       AND sequence > $2 ORDER BY sequence ASC LIMIT 1`,
      [instanceId, step[0].sequence]
    );

    if (nextStep.length > 0) {
      await db.query(`UPDATE workflow_instance_steps SET status = 'awaiting_action'
        WHERE id = $1`,
        [nextStep[0].id]);
    } else {
      await db.query(`UPDATE workflow_instances SET status = 'approved' WHERE id = $1`, [
        instanceId,
      ]);
      // TODO: trigger post-approval callback
    }

    return res.send({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).send({ error: 'Internal server error' });
  }
});
