import multipart from '@fastify/multipart';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseFile } from '../agent-runtime/public.mjs';
import { loadConversation } from './chat-service.mjs';
import { saveTask, event } from './repository.mjs';
import { chatArtifact } from './chat-workflow.mjs';
import { fault } from './policy.mjs';
import { legacyChatFiles, legacyChatFile } from './chat-legacy.mjs';

let activeParsers = 0;
const uuid = (value) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value ?? ''))
    throw fault('INVALID_INPUT');
  return value;
};

export function registerChatFiles(app, pool, base, { authorize, write }) {
  const access = async (req, db = pool, scope, lock = false) =>
    loadConversation(
      db,
      scope ?? (await authorize(req, db)),
      uuid(req.params.conversationId),
      lock,
    );
  const editable = async (db, task) => {
    if (
      (
        await db.query(
          "SELECT 1 FROM app.fsd_v1_run WHERE task_id=$1 AND status IN ('QUEUED','RUNNING')",
          [task.id],
        )
      ).rowCount
    )
      throw fault('CHAT_RUN_ACTIVE', 'INPUT', 409);
  };
  const attachment = async (db, task, id) => {
    uuid(id);
    if ((task.chat.removedAttachments ?? []).includes(id)) throw fault('NOT_FOUND', 'INPUT', 404);
    const row = (
      await db.query('SELECT * FROM app.fsd_v1_attachment WHERE task_id=$1 AND id=$2', [
        task.id,
        id,
      ])
    ).rows[0];
    if (!row) throw fault('NOT_FOUND', 'INPUT', 404);
    return row;
  };
  const changed = async (db, task) => {
    const invalidates =
      task.chat.draftApproved ||
      ['PLAN_CONFIRM', 'FSD_CONFIRM'].includes(task.wait_reason) ||
      task.status === 'DELIVERED';
    task.revision++;
    task.input_version++;
    if (invalidates) {
      task.chat.draftApproved = false;
      task.chat.revising = true;
      task.confirmations = [];
      task.wait = null;
      task.wait_reason = 'CHAT_READY';
      task.status = 'WAITING';
      delete task.delivered_artifact_id;
      await db.query(
        "UPDATE app.fsd_v1_run SET status='CANCELLED',generation=generation+1,lease_until=NULL WHERE id=$1",
        [task.active_run_id],
      );
      await event(
        db,
        task.id,
        task.active_run_id,
        'approval.invalidated',
        { reason: 'MATERIALS_CHANGED' },
        task.actor_id,
      );
    }
    await db.query('UPDATE app.fsd_v1_run SET expected_revision=$2 WHERE id=$1', [
      task.active_run_id,
      task.revision,
    ]);
    await saveTask(db, task);
  };
  app.register(async (child) => {
    await child.register(multipart, {
      preservePath: true,
      limits: { files: 1, fields: 0, parts: 1, fileSize: 20971520 },
    });
    child.post(
      base + '/conversations/:conversationId/attachments',
      { bodyLimit: 21000000 },
      async (req) => {
        await access(req);
        if (activeParsers >= 2) throw fault('RATE_LIMIT', 'INPUT', 429);
        activeParsers++;
        let file;
        try {
          return await write(req, async (db, scope) => {
            const task = await access(req, db, scope, true);
            await editable(db, task);
            let part, bytes;
            for await (const next of req.parts()) {
              if (part || next.type !== 'file' || next.fieldname !== 'file')
                throw fault('INVALID_ATTACHMENT');
              part = next;
              bytes = await part.toBuffer();
            }
            const name = part?.filename;
            if (
              typeof name !== 'string' ||
              name.length > 180 ||
              /[\\/\x00-\x1f]|\.\./.test(name) ||
              !/\.(txt|md|csv|json|xml|log|abap|yaml|yml|pdf|docx|xlsx|png|jpg|jpeg|gif|webp|bmp|avif)$/i.test(
                name,
              )
            )
              throw fault('INVALID_ATTACHMENT');
            if (!bytes.length) throw fault('INVALID_ATTACHMENT');
            if (part.file.truncated || bytes.length > 20971520)
              throw fault('PAYLOAD_TOO_LARGE', 'INPUT', 413);
            const quota = (
              await db.query(
                'SELECT count(*)::int AS n,COALESCE(sum(octet_length(bytes)),0)::bigint AS size FROM app.fsd_v1_attachment WHERE task_id=$1 AND NOT(id=ANY($2::uuid[]))',
                [task.id, task.chat.removedAttachments ?? []],
              )
            ).rows[0];
            if (quota.n >= 10 || Number(quota.size) + bytes.length > 52428800)
              throw fault('PAYLOAD_TOO_LARGE', 'INPUT', 413);
            const id = randomUUID(),
              directory = resolve('.runtime/cache/fsd-chat-materials');
            await mkdir(directory, { recursive: true });
            file = resolve(directory, id);
            await writeFile(file, bytes, { flag: 'wx' });
            const extraction = await parseFile(file, name);
            await db.query(
              'INSERT INTO app.fsd_v1_attachment(id,task_id,name,media_type,bytes,content_hash,extraction) VALUES($1,$2,$3,$4,$5,$6,$7)',
              [
                id,
                task.id,
                name,
                String(part.mimetype).slice(0, 100),
                bytes,
                createHash('sha256').update(bytes).digest('hex'),
                extraction,
              ],
            );
            task.attachment_ids.push(id);
            await changed(db, task);
            return { id, name, state: extraction.state, warnings: extraction.warnings, extraction };
          });
        } finally {
          if (file) await unlink(file).catch(() => {});
          activeParsers--;
        }
      },
    );
  });
  app.delete(base + '/conversations/:conversationId/attachments/:attachmentId', async (req) =>
    write(req, async (db, scope) => {
      const task = await access(req, db, scope, true);
      await editable(db, task);
      const row = await attachment(db, task, req.params.attachmentId);
      task.chat.removedAttachments = [...(task.chat.removedAttachments ?? []), row.id];
      task.attachment_ids = task.attachment_ids.filter((id) => id !== row.id);
      await changed(db, task);
      return { deleted: true };
    }),
  );
  app.get(base + '/sessions/:conversationId/files', async (req) => {
    const scope = await authorize(req);
    let task;
    try {
      task = await access(req, pool, scope);
    } catch (error) {
      if (error.code !== 'NOT_FOUND') throw error;
      return legacyChatFiles(pool, scope, req.params.conversationId);
    }
    const inputs = (
      await pool.query(
        "SELECT id,name,octet_length(bytes) AS bytes,created_at,extraction->>'state' AS state,extraction->'warnings' AS warnings FROM app.fsd_v1_attachment WHERE task_id=$1 AND NOT(id=ANY($2::uuid[])) ORDER BY created_at,id",
        [task.id, task.chat.removedAttachments ?? []],
      )
    ).rows;
    const outputs = (task.artifacts ?? [])
      .map((a) => ({
        id: a.id,
        revision: a.version,
        created_at: a.created_at,
        content_hash: chatArtifact(a).contentHash,
      }))
      .reverse();
    return { inputs, outputs };
  });
  app.get(base + '/sessions/:conversationId/files/:fileId', async (req) => {
    const scope = await authorize(req);
    let task;
    try {
      task = await access(req, pool, scope);
    } catch (error) {
      if (error.code !== 'NOT_FOUND') throw error;
      return legacyChatFile(pool, scope, req.params.conversationId, req.params.fileId);
    }
    const row = await attachment(pool, task, req.params.fileId);
    return { id: row.id, name: row.name, state: row.extraction.state, extraction: row.extraction };
  });
  app.get(base + '/conversations/:conversationId/attachments/:attachmentId', async (req, reply) => {
    const task = await access(req),
      row = await attachment(pool, task, req.params.attachmentId);
    return reply
      .header('Content-Type', 'application/octet-stream')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(row.name)}`)
      .send(row.bytes);
  });
}
