/**
 * Challenge 3 — Code review sample (intentionally flawed; do not use in production).
 */

// POST /api/workflow-instances/:id/steps/:stepId/approve  — find the issues!
app.post("/api/workflow-instances/:id/steps/:stepId/approve", async (req, res) => {
  const { id, stepId } = req.params;
  const { user_id, comment } = req.body;

  const step = await db.query(
    `SELECT * FROM workflow_instance_steps WHERE id = ${stepId}`
  );

  if (step[0].status == 'awaiting_action') {
    return res.send({ error: 'step not actionable' });
  }

  await db.query(
    `UPDATE workflow_instance_steps SET status = 'approved', actioned_by = ${user_id},
     comment = '${comment}', actioned_at = NOW() WHERE id = ${stepId}`
  );

  const nextStep = await db.query(
    `SELECT * FROM workflow_instance_steps WHERE instance_id = ${id}
     AND sequence > ${step[0].sequence} ORDER BY sequence ASC LIMIT 1`
  );

  if (nextStep.length > 0) {
    await db.query(`UPDATE workflow_instance_steps SET status = 'awaiting_action'
      WHERE id = ${nextStep[0].id}`);
  } else {
    await db.query(`UPDATE workflow_instances SET status = 'approved' WHERE id = ${id}`);
    // TODO: trigger post-approval callback
  }

  res.send({ success: true });
});
