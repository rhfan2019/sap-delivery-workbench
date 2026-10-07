import {pinModel} from '../agent/context.mjs';
import { randomUUID } from 'node:crypto';
import { failure } from '../../auth.mjs';
import { contentHash } from '../document/ast.mjs';
import { loadVersion } from '../document/repository.mjs';
import { runDto } from '../runs/service.mjs';
import { appendRunEvent } from '../runs/events.mjs';
export const sessionDto = (row) => ({
  id: row.id,
  title: row.title,
  created_at: new Date(row.created_at).toISOString(),
  archived: Boolean(row.archived_at),
});
export const messageDto = (row) => ({
  id: row.id,
  session_id: row.session_id,
  sequence: String(row.seq),
  role: row.role,
  content: row.body,
  attachment_ids: row.request_json?.attachment_ids ?? [],
  selection: row.source_selection,
  created_at: new Date(row.created_at).toISOString(),
});
export async function loadSession(db, scope, id) {
  const {
    rows: [session],
  } = await db.query(
    'SELECT * FROM app.fs_session WHERE organization_id=$1 AND project_id=$2 AND workspace_id=$3 AND id=$4',
    [scope.organizationId, scope.projectId, scope.workspaceId, id],
  );
  if (!session) throw failure(404, '会话不存在或无权访问。');
  return session;
}
export async function appendMessageAndRun(db, scope, workspace, sessionId, input) {
  const session = await loadSession(db, scope, sessionId);
  if (session.archived_at) throw failure(409, '会话已归档。');
  const {
    rows: [prior],
  } = await db.query('SELECT * FROM app.fs_message WHERE session_id=$1 AND client_message_id=$2', [
    sessionId,
    input.client_message_id,
  ]);
  if (prior) {
    if (contentHash(prior.request_json) !== contentHash(input))
      throw failure(409, '消息 ID 已用于不同内容。');
    const {
      rows: [run],
    } = await db.query('SELECT * FROM app.fs_run WHERE id=$1', [prior.run_id]);
    return { message: messageDto(prior), run: runDto(run) };
  }
  const document = await loadVersion(db, scope, workspace.draft_head);
  if (input.selection) {
    const selected = await loadVersion(db, scope, input.selection.document_version_id);
    const block = selected.ast.sections
      .flatMap((s) => s.blocks)
      .find((b) => b.id === input.selection.block_id);
    if (
      !block ||
      typeof block.text !== 'string' ||
      input.selection.end < input.selection.start ||
      input.selection.end > block.text.length ||
      contentHash(block.text.slice(input.selection.start, input.selection.end)) !==
        input.selection.text_hash
    )
      throw failure(409, '选区内容与固定版本不符。');
  }
  const attachments = [];
  for (const id of input.attachment_ids) {
    const {
      rows: [attachment],
    } = await db.query(
      'SELECT id,hash,scan_status FROM app.fs_attachment WHERE organization_id=$1 AND project_id=$2 AND workspace_id=$3 AND id=$4',
      [scope.organizationId, scope.projectId, scope.workspaceId, id],
    );
    if (!attachment) throw failure(404, '附件不存在或无权访问。');
    const {rows:[parsed]}=await db.query('SELECT id,hash,state,revision,regions FROM app.fs_parse_result WHERE attachment_id=$1 ORDER BY revision DESC LIMIT 1',[id]);
    attachments.push({id,kind:'attachment',hash:attachment.hash,scan_state:attachment.scan_status,parse_id:parsed?.id??null,parse_hash:parsed?.hash??null,parse_state:parsed?.state??null});
  }
  const {
    rows: [counter],
  } = await db.query(
    'SELECT coalesce(max(seq),0)::text AS n FROM app.fs_message WHERE session_id=$1',
    [sessionId],
  );
  const sequence = BigInt(counter.n) + 1n;
  if (sequence > BigInt(Number.MAX_SAFE_INTEGER)) throw failure(409, '消息序列超出范围。');
  const messageId = randomUUID(),
    snapshotId = randomUUID(),
    runId = randomUUID();
  let model=null,errorCode=null;
  try{model=await pinModel(db,scope.organizationId);}catch(error){if(![409,503].includes(error.statusCode))throw error;errorCode='MODEL_CONFIGURATION_REQUIRED';}
  if(attachments.some(a=>a.scan_state!=='clean'||a.parse_state!=='complete'))errorCode='ATTACHMENT_NOT_READY';
  const evidenceId=randomUUID();
  const sourceHash=contentHash(input.content);
  const {rows:priorEvidence}=await db.query("SELECT e.id,e.hash,e.source_revision AS revision,'evidence' AS kind FROM app.fs_evidence e JOIN app.fs_message m ON m.id=e.source_id WHERE e.workspace_id=$1 AND e.source_kind='message' AND m.session_id=$2",[workspace.id,sessionId]);
  const manifest = [
    {
      id: document.id,
      revision: String(document.seq),
      hash: document.content_hash,
      kind: 'document',
    },
    ...document.entity_manifest,
    ...document.evidence_manifest.map(e=>({...e,kind:'evidence'})),
    ...priorEvidence,
    {id:evidenceId,hash:sourceHash,revision:'1',kind:'evidence'},
    ...attachments,
  ];
  await db.query(
    `INSERT INTO app.fs_context_snapshot(id,organization_id,project_id,workspace_id,version_manifest,message_range,config_versions,input_hash,token_budget,coverage)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,16000,$9)`,
    [
      snapshotId,
      scope.organizationId,
      scope.projectId,
      workspace.id,
      JSON.stringify(manifest),
      JSON.stringify([
        { session_id: sessionId, from: '1', to: String(sequence), message_id: messageId },
      ]),
      {
        template_version: document.template.version,
        schema_version: '1.0.0',
        model_version_id:null,
        prompt_version:'fs-agent-v1',
        ...model,
      },
      contentHash({ input, manifest }),
      { messages_through: String(sequence), attachments, model_ready: Boolean(model) },
    ],
  );
  const {
    rows: [run],
  } = await db.query(
    `INSERT INTO app.fs_run(id,organization_id,project_id,workspace_id,session_id,input_snapshot_id,principal_user_id,principal_session_id,intent,status,node_id,budget_json,is_write)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$11,'orchestrate',$10,true) RETURNING *`,
    [
      runId,
      scope.organizationId,
      scope.projectId,
      workspace.id,
      sessionId,
      snapshotId,
      scope.actorId,
      scope.sessionId,
      input.intent,
      {error_code:errorCode,max_attempts:6},
      errorCode?'waiting_evidence':'queued',
    ],
  );
  const {
    rows: [message],
  } = await db.query(
    `INSERT INTO app.fs_message(id,organization_id,project_id,workspace_id,session_id,seq,client_message_id,role,body,source_selection,created_by,request_json,run_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,'user',$8,$9,$10,$11,$12) RETURNING *`,
    [
      messageId,
      scope.organizationId,
      scope.projectId,
      workspace.id,
      sessionId,
      sequence.toString(),
      input.client_message_id,
      input.content,
      input.selection,
      scope.actorId,
      input,
      runId,
    ],
  );
  await db.query("INSERT INTO app.fs_evidence(id,organization_id,project_id,workspace_id,source_kind,source_id,source_revision,locator,conclusion,scope,hash,limitations,created_by) VALUES($1,$2,$3,$4,'message',$5,'1',$6,$7,'source_statement',$8,'[\"用户陈述，未经技术验证\"]',$9)",[evidenceId,scope.organizationId,scope.projectId,workspace.id,messageId,'message:'+messageId+':0-'+input.content.length,input.content,sourceHash,scope.actorId]);
  await appendRunEvent(db,run,errorCode?'run.waiting':'run.queued',errorCode?'消息已保存，请完成模型配置或附件解析后重试。':'消息已保存，Agent已排队。',{error_code:errorCode,retryable:Boolean(errorCode)});
  return { message: messageDto(message), run: runDto(run) };
}
