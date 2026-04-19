/**
 * Category: SQL injection — parameterized queries only (see flawed-approve-handler.js).
 * Query result shape unchanged from sample (e.g. step[0]); fix under another category if needed.
 */

// POST /api/workflow-instances/:id/steps/:stepId/approve
app.post('/api/workflow-instances/:id/steps/:stepId/approve', async (req, res) => {
  const { id, stepId } = req.params;
  const { user_id, comment } = req.body;

  const step = await db.query(
    `SELECT * FROM workflow_instance_steps WHERE id = $1`,
    [stepId]
  );

  if (step[0].status == 'awaiting_action') {
    return res.send({ error: 'step not actionable' });
  }

  await db.query(
    `UPDATE workflow_instance_steps SET status = 'approved', actioned_by = $1,
     comment = $2, actioned_at = NOW() WHERE id = $3`,
    [user_id, comment, stepId]
  );

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
