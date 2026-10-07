import multipart from '@fastify/multipart';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { failure } from '../auth.mjs';
import { conversation } from './repository.mjs';
import { parseFile } from './attachment-parser.mjs';
const root = fileURLToPath(new URL('../../../../.runtime/fsd-agent-files/', import.meta.url));
const uuid = /^[0-9a-f-]{36}$/i;
export function registerAgentAttachments(
  app,
  { c, pool, org, delivery, prefix = '/api/admin/abap-fsd-agent' },
) {
  let active = 0;
  const access = async (req, db = pool) => {
    const current = await c.authorize(req, db);
    if (!uuid.test(req.params.id)) throw failure(400, '会话ID无效');
    const s = await conversation(db, org, current.user.id, req.params.id);
    c.assertConversation?.(req, s);
    if (s.selection.projectId) await delivery.access(db, current, s.selection.projectId);
    return { current, s };
  };
  app.register(async (child) => {
    await child.register(multipart, {
      limits: { files: 1, fields: 0, parts: 1, fileSize: 20971520 },
    });
    child.post(prefix + '/conversations/:id/attachments', { bodyLimit: 21000000 }, async (req) => {
      const { current } = await access(req);
      if (active >= 2) throw failure(429, '附件处理繁忙，请稍后重试');
      active++;
      let id, file;
      try {
        const part = await req.file();
        if (!part || part.fieldname !== 'file') throw failure(400, '需要file字段');
        const bytes = await part.toBuffer();
        if (part.file.truncated || bytes.length > 20971520) throw failure(413, '单文件超过20MB');
        if (!bytes.length) throw failure(400, '不能上传空文件');
        const name = part.filename.replace(/[\\/\x00-\x1f]/g, '_').slice(0, 180);
        const hash = createHash('sha256').update(bytes).digest('hex');
        id = await c.write(
          req,
          'abap_fsd_agent.attachment.upload',
          'fsd_agent_session',
          async (db) => {
            await access(req, db);
            await db.query('SELECT id FROM app.fsd_agent_session WHERE id=$1 FOR UPDATE', [
              req.params.id,
            ]);
            const {
              rows: [q],
            } = await db.query(
              "SELECT count(*)::int AS n,COALESCE(sum(bytes),0)::int AS bytes FROM app.fsd_agent_attachment WHERE conversation_id=$1 AND state<>'deleted'",
              [req.params.id],
            );
            if (q.n >= 10 || q.bytes + bytes.length > 52428800)
              throw failure(413, '最多10个附件、总计50MB');
            const id = randomUUID();
            await db.query(
              'INSERT INTO app.fsd_agent_attachment(id,organization_id,actor_id,conversation_id,name,bytes,content_hash,state) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
              [id, org, current.user.id, req.params.id, name, bytes.length, hash, 'processing'],
            );
            return { subjectId: req.params.id, data: id };
          },
        );
        await mkdir(root, { recursive: true });
        file = path.join(root, id);
        await writeFile(file, bytes, { flag: 'wx' });
        const extraction = await parseFile(file, name);
        await access(req);
        const { rows } = await pool.query(
          "UPDATE app.fsd_agent_attachment SET state=$4,extraction=$5 WHERE organization_id=$1 AND actor_id=$2 AND id=$3 AND state='processing' RETURNING id,name,state,content_hash,extraction",
          [org, current.user.id, id, extraction.state, extraction],
        );
        if (!rows[0]) throw failure(409, '附件已删除');
        return rows[0];
      } catch (e) {
        if (id)
          await pool.query(
            "UPDATE app.fsd_agent_attachment SET state='failed' WHERE organization_id=$1 AND actor_id=$2 AND id=$3 AND state='processing'",
            [org, current.user.id, id],
          );
        throw e;
      } finally {
        if (file) await unlink(file).catch(() => {});
        active--;
      }
    });
  });
  app.delete(prefix + '/conversations/:id/attachments/:attachmentId', async (req) => {
    const { current } = await access(req);
    if (!uuid.test(req.params.attachmentId)) throw failure(400, '附件ID无效');
    await pool.query(
      "UPDATE app.fsd_agent_attachment SET state='deleted' WHERE organization_id=$1 AND actor_id=$2 AND conversation_id=$3 AND id=$4",
      [org, current.user.id, req.params.id, req.params.attachmentId],
    );
    return { deleted: true };
  });
}
export async function readyAttachments(db, org, actor, conversationId, ids = []) {
  if (!ids.length) return [];
  if (!conversationId) throw failure(400, '附件必须属于当前会话');
  const { rows } = await db.query(
    'SELECT id,name,content_hash,state,extraction FROM app.fsd_agent_attachment WHERE organization_id=$1 AND actor_id=$2 AND conversation_id=$3 AND id=ANY($4::uuid[])',
    [org, actor, conversationId, ids],
  );
  if (rows.length !== ids.length || rows.some((a) => a.state !== 'ready'))
    throw failure(409, '附件未处理完成、已删除或不属于当前会话，未发送模型');
  return ids.map((id) => rows.find((a) => a.id === id));
}
