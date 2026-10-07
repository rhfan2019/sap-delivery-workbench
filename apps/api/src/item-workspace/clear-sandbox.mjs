// Explicit maintenance operation. Never invoked by page loads or migrations.
export async function clearSandboxHistory(db, org) {
  if (!/^[0-9a-f-]{36}$/i.test(org ?? '')) throw new Error('Explicit organization required');
  await db.query('BEGIN');
  try {
    await db.query(
      'LOCK TABLE app.fsd_agent_session,app.fsd_agent_run,app.fsd_agent_revision,app.fsd_agent_attachment,app.item_work_version IN SHARE ROW EXCLUSIVE MODE',
    );
    const { rows } = await db.query(
      "SELECT id FROM app.fsd_agent_session WHERE organization_id=$1 AND NOT(selection ? 'workspaceStage') AND cleared_at IS NULL FOR UPDATE",
      [org],
    );
    const ids = rows.map((r) => r.id);
    const active = await db.query(
      "SELECT id FROM app.fsd_agent_run WHERE conversation_id=ANY($1::uuid[]) AND state IN ('queued','running')",
      [ids],
    );
    if (active.rows.length) throw new Error('Sandbox runs still active; cleanup refused');
    const attachments = await db.query(
      'DELETE FROM app.fsd_agent_attachment WHERE conversation_id=ANY($1::uuid[])',
      [ids],
    );
    const revisions = await db.query(
      'DELETE FROM app.fsd_agent_revision r WHERE conversation_id=ANY($1::uuid[]) AND NOT EXISTS(SELECT 1 FROM app.item_work_version v WHERE v.source_artifact_id=r.id)',
      [ids],
    );
    const runs = await db.query(
      'DELETE FROM app.fsd_agent_run r WHERE conversation_id=ANY($1::uuid[]) AND NOT EXISTS(SELECT 1 FROM app.fsd_agent_revision v WHERE v.run_id=r.id)',
      [ids],
    );
    const retained = await db.query(
      "UPDATE app.fsd_agent_run SET snapshot='{}',state='completed' WHERE conversation_id=ANY($1::uuid[])",
      [ids],
    );
    await db.query(
      "UPDATE app.fsd_agent_session SET cleared_at=now(),context='{}' WHERE id=ANY($1::uuid[])",
      [ids],
    );
    const removed = await db.query(
      'DELETE FROM app.fsd_agent_session s WHERE id=ANY($1::uuid[]) AND NOT EXISTS(SELECT 1 FROM app.fsd_agent_revision r WHERE r.conversation_id=s.id)',
      [ids],
    );
    const report = {
      sessions: ids.length,
      deletedSessions: removed.rowCount,
      attachments: attachments.rowCount,
      unreferencedArtifacts: revisions.rowCount,
      deletedRuns: runs.rowCount,
      retainedArtifactRuns: retained.rowCount,
    };
    await db.query(
      "INSERT INTO app.audit_event(organization_id,action,outcome,subject_type,subject_id,request_id,details) VALUES($1,'sandbox.history.clear','success','organization',$1,gen_random_uuid(),$2)",
      [org, report],
    );
    await db.query('COMMIT');
    return report;
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  }
}
