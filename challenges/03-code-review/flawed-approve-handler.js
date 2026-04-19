/**
 * Challenge 3 — Code review sample (intentionally flawed; do not use in production).
 *
 * Addressed so far: SQL injection; inverted status; race (lock_version); authorisation;
 * validation & errors; HTTP status codes; multi-statement transactional integrity (BEGIN/COMMIT).
 *
 * Requires `db` to be a pg Pool (or compatible): `db.connect()` → client with `.query` / `.release`.
 */

// HTTP status policy for this route:
// - 200 OK           — approval applied, body { success: true }
// - 400 Bad Request  — malformed ids or body (cannot parse / missing required fields)
// - 403 Forbidden    — authenticated/identified user is not an assignee for this step
// - 404 Not Found    — no such step, or step does not belong to this instance (same message)
// - 409 Conflict     — optimistic lock lost (another approver committed first)
// - 422 Unprocessable Entity — step exists but is not in a state that allows approval (or bad step data)
// - 500 Internal Server Error — unexpected failure (logged); never leak stack to client

// POST /api/workflow-instances/:id/steps/:stepId/approve  — find the issues!
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

    const client = await db.connect();
    try {
      await client.query('BEGIN');

      const step = await client.query(
        `SELECT * FROM workflow_instance_steps WHERE id = $1`,
        [stepIdNum]
      );

      if (!step[0] || String(step[0].instance_id) !== String(instanceId)) {
        await client.query('ROLLBACK');
        return res.status(404).send({ error: 'Step not found' });
      }

      if (step[0].status != 'awaiting_action') {
        await client.query('ROLLBACK');
        return res.status(422).send({
          error: 'This step is not awaiting approval in its current state',
        });
      }

      const s = step[0];
      if (s.approver_kind === 'USER') {
        if (String(s.user_id) !== String(actorId)) {
          await client.query('ROLLBACK');
          return res.status(403).send({ error: 'You are not assigned to approve this step' });
        }
      } else if (s.approver_kind === 'ROLE') {
        const membership = await client.query(
          `SELECT 1 FROM user_roles WHERE user_id = $1 AND role_id = $2 LIMIT 1`,
          [actorId, s.role_id]
        );
        if (membership.rowCount === 0) {
          await client.query('ROLLBACK');
          return res.status(403).send({ error: 'You are not assigned to approve this step' });
        }
      } else {
        await client.query('ROLLBACK');
        return res.status(422).send({ error: 'Invalid step configuration' });
      }

      const updated = await client.query(
        `UPDATE workflow_instance_steps SET status = 'approved', actioned_by = $1,
         comment = $2, actioned_at = NOW(), lock_version = lock_version + 1
         WHERE id = $3 AND status = 'awaiting_action' AND lock_version = $4`,
        [actorId, commentText, stepIdNum, lockVer]
      );

      if (updated.rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(409).send({
          error: 'This step was already completed by another approver; refresh and try again.',
        });
      }

      const nextStep = await client.query(
        `SELECT * FROM workflow_instance_steps WHERE instance_id = $1
         AND sequence > $2 ORDER BY sequence ASC LIMIT 1`,
        [instanceId, step[0].sequence]
      );

      if (nextStep.length > 0) {
        await client.query(`UPDATE workflow_instance_steps SET status = 'awaiting_action'
          WHERE id = $1`,
          [nextStep[0].id]);
      } else {
        await client.query(`UPDATE workflow_instances SET status = 'approved' WHERE id = $1`, [
          instanceId,
        ]);
        // TODO: trigger post-approval callback
      }

      await client.query('COMMIT');
      return res.status(200).send({ success: true });
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch (_) {
        /* ignore */
      }
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error(err);
    return res.status(500).send({ error: 'Internal server error' });
  }
});
