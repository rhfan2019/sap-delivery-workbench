import { failure } from '../auth.mjs';
import { conversation } from '../abap-fsd-agent/repository.mjs';
import { readSessionState } from '../abap-fsd-agent/session-state.mjs';
import { findWorkspace } from '../fs-workspace/workspace/repository.mjs';
import { head } from './service.mjs';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function resolveWorkAction(prompt) {
  if (
    /(不要|暂不|别|不需要|无需|不用|不).{0,8}(生成|输出|修改|更新|写入|起草|补充|完善|编写|重写|修订|实现)/.test(
      prompt,
    )
  )
    return 'dialogue';
  if (/^(?:请)?(?:为什么|如何|怎么|解释|能解释)|什么意思|是什么意思/.test(prompt.trim()))
    return 'dialogue';
  return /(生成|输出|起草|编写|修改|更新|完善|补充|写入|重写|修订|实现).{0,40}(说明书|文档|FSD|FS\b|代码|程序|开发内容|技术设计|测试方案)|(?:说明书|文档|代码|程序).{0,20}(生成|修改|更新|补充|完善)/i.test(
    prompt,
  )
    ? 'draft'
    : 'dialogue';
}
export function handoffSummary(state) {
  const excerpts = state.history
    .filter((m) => m.role === 'user' && m.content)
    .slice(-6)
    .map((m) => m.content.slice(0, 700));
  const answers = state.decisions.slice(-10).map((a) => `${a.question}: ${a.label}`.slice(0, 160));
  return (
    '历史用户要求摘录（非完整总结，请核对；当前成果和新指令优先）：\n' +
    excerpts.join('\n\n') +
    '\n已确认回答：\n' +
    answers.join('\n')
  ).slice(0, 6000);
}
export async function prepareConversationContext(db, req, c) {
  const from = req.body?.handoffFrom;
  const ws = await findWorkspace(db, req.work.scope);
  const current = ws && (await head(db, ws.id, req.params.stage));
  const context = { draftVersionId: current?.id ?? null, summary: '', sourceConversationId: null };
  if (from) {
    if (!uuid.test(from)) throw failure(400, '来源对话标识无效。');
    const s = await conversation(db, c.organizationId, req.work.current.user.id, from);
    c.assertConversation(req, s);
    const state = await readSessionState(db, c.organizationId, req.work.current.user.id, from);
    context.summary = handoffSummary(state);
    context.sourceConversationId = from;
  }
  return context;
}
export function registerConversationFiles(app, c, base) {
  async function access(req) {
    const current = await c.authorize(req);
    if (!uuid.test(req.params.sessionId)) throw failure(400, '对话标识无效。');
    const s = await conversation(c.pool, c.organizationId, current.user.id, req.params.sessionId);
    c.assertConversation(req, s);
    return [c.organizationId, current.user.id, s.id];
  }
  app.get(base + '/sessions/:sessionId/files', async (req) => {
    const scope = await access(req);
    const inputs = await c.pool.query(
      "SELECT id,name,bytes,state,created_at,extraction->'warnings' AS warnings FROM app.fsd_agent_attachment WHERE organization_id=$1 AND actor_id=$2 AND conversation_id=$3 AND state<>'deleted' ORDER BY created_at,id",
      scope,
    );
    const outputs = await c.pool.query(
      'SELECT id,revision,created_at,content_hash FROM app.fsd_agent_revision WHERE organization_id=$1 AND actor_id=$2 AND conversation_id=$3 ORDER BY revision DESC',
      scope,
    );
    return { inputs: inputs.rows, outputs: outputs.rows };
  });
  app.get(base + '/sessions/:sessionId/files/:fileId', async (req) => {
    const scope = await access(req);
    if (!uuid.test(req.params.fileId)) throw failure(400, '文件标识无效。');
    const { rows } = await c.pool.query(
      "SELECT id,name,state,extraction FROM app.fsd_agent_attachment WHERE organization_id=$1 AND actor_id=$2 AND conversation_id=$3 AND id=$4 AND state<>'deleted'",
      [...scope, req.params.fileId],
    );
    if (!rows[0]) throw failure(404, '文件不属于当前对话。');
    return rows[0];
  });
}
