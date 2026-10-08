import { createHash } from 'node:crypto';
import multipart from '@fastify/multipart';
import { unlink, readFile } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { failure } from '../../../platform/auth.mjs';
import { authorizeWorkspace } from '../access.mjs';
import {
  readContext,
  envelope,
  uuidPattern,
  commandError,
  executeCommand,
} from '../workspace/commands.mjs';
import { enqueueParse } from '../runs/service.mjs';
import { contentHash } from '../document/ast.mjs';
import { storeQuarantined } from './storage.mjs';
import {
  attachmentDto,
  persistUpload,
  shouldDiscardUpload,
  readAttachments,
} from './repository.mjs';
const base = '/api/projects/:projectId/development-items/:id/fs-workspace';

export function registerAttachmentRoutes(app, c) {
  const folder =
    process.env.FS_ATTACHMENTS_DIR ??
    fileURLToPath(new URL('../../../../../../.runtime/fs-attachments/', import.meta.url));
  if (
    !isAbsolute(folder) ||
    (process.env.NODE_ENV === 'production' && !process.env.FS_ATTACHMENTS_DIR)
  )
    throw new Error('Configure absolute FS_ATTACHMENTS_DIR');
  app.register(async (child) => {
    await child.register(multipart, {
      limits: { files: 1, fields: 1, parts: 2, fileSize: 5242880, fieldSize: 64 },
    });
    child.post(base + '/attachments', { bodyLimit: 5300000 }, async (req, reply) => {
      const initial = await readContext(c, req);
      if (!initial.capabilities.can_edit) throw failure(403, '无权上传附件。');
      const key = req.headers['idempotency-key'];
      if (typeof key !== 'string' || !uuidPattern.test(key))
        throw commandError(428, 'PRECONDITION_REQUIRED', '需要合法的 Idempotency-Key。');
      let uploadId,
        blob,
        committed = false;
      try {
        for await (const part of req.parts()) {
          if (part.type === 'file') {
            if (part.fieldname !== 'file' || blob) throw failure(400, '只允许一个 file 字段。');
            blob = await storeQuarantined(part.file, {
              folder,
              name: part.filename,
              mime: part.mimetype,
            });
            if (part.file.truncated) throw failure(413, '文件不能超过 5 MiB。');
          } else {
            if (
              part.fieldname !== 'client_upload_id' ||
              uploadId ||
              part.valueTruncated ||
              !uuidPattern.test(part.value)
            )
              throw failure(400, '上传 ID 无效。');
            uploadId = part.value;
          }
        }
        if (!uploadId || !blob) throw failure(400, '需要上传 ID 和文件。');
        const result = await c.write(req, async (db, current, project) => {
          await db.query(
            'SELECT id FROM app.project WHERE organization_id=$1 AND id=$2 FOR UPDATE',
            [c.organizationId, req.params.projectId],
          );
          project = await c.access(db, current, req.params.projectId, true);
          const authorized = await authorizeWorkspace(c, req, db, current, project, {
            write: true,
          });
          const scope = { ...authorized.scope };
          const {
            rows: [workspace],
          } = await db.query(
            'SELECT * FROM app.fs_workspace WHERE organization_id=$1 AND project_id=$2 AND item_id=$3 AND active FOR UPDATE',
            [scope.organizationId, scope.projectId, scope.itemId],
          );
          if (!workspace) throw failure(404, '工作区不存在。');
          scope.workspaceId = workspace.id;
          const hash = contentHash({
            uploadId,
            name: blob.name,
            mime: blob.mime,
            size: blob.size_bytes,
            sha256: blob.sha256,
          });
          const {
            rows: [receipt],
          } = await db.query(
            "SELECT request_hash,result FROM app.fs_command_receipt WHERE workspace_id=$1 AND actor_id=$2 AND action='uploadFsAttachment' AND key=$3",
            [workspace.id, scope.actorId, key],
          );
          if (receipt) {
            if (receipt.request_hash !== hash)
              throw commandError(409, 'IDEMPOTENCY_CONFLICT', '幂等键内容冲突。');
            return receipt.result.data;
          }
          const data = await persistUpload(db, scope, uploadId, blob);
          await db.query(
            "INSERT INTO app.fs_command_receipt(organization_id,project_id,workspace_id,actor_id,action,key,request_hash,status,result) VALUES($1,$2,$3,$4,'uploadFsAttachment',$5,$6,'committed',$7)",
            [
              scope.organizationId,
              scope.projectId,
              workspace.id,
              scope.actorId,
              key,
              hash,
              { data, result_ids: [data.id], workspace_revision: String(workspace.row_version) },
            ],
          );
          await c.event(db, req, current, 'uploadFsAttachment', {
            workspace_id: workspace.id,
            attachment_id: data.id,
          });
          return data;
        });
        committed = result.id === blob.id;
        reply.code(202);
        return envelope(req, result);
      } finally {
        if (blob && !committed && (await shouldDiscardUpload(c.pool, blob.id)))
          await unlink(join(folder, blob.blob_key));
      }
    });
    child.get(base + '/attachments', async (req) => {
      const { scope } = await readContext(c, req);
      const { rows } = await readAttachments(c.pool, scope);
      return envelope(req, { items: rows, next_cursor: null });
    });
    child.post(base + '/attachments/:attachmentId/parse', async (req, reply) => {
      if (!uuidPattern.test(req.params.attachmentId)) throw failure(404, '附件不存在或无权访问。');
      const result = await executeCommand(
        c,
        req,
        'retryFsParse',
        async (db, scope, workspace) => {
          const run = await enqueueParse(
            db,
            scope,
            workspace,
            req.params.attachmentId,
            req.body.region_ids,
          );
          return { data: run, result_ids: [run.id] };
        },
        { head: false },
      );
      reply.code(202);
      return result;
    });
    child.get(base + '/attachments/:attachmentId/source', async (req, reply) => {
      const { scope } = await readContext(c, req);
      if (!uuidPattern.test(req.params.attachmentId)) throw failure(404, '附件不存在或无权访问。');
      const {
        rows: [row],
      } = await c.pool.query(
        'SELECT * FROM app.fs_attachment WHERE organization_id=$1 AND project_id=$2 AND workspace_id=$3 AND id=$4',
        [scope.organizationId, scope.projectId, scope.workspaceId, req.params.attachmentId],
      );
      if (!row) throw failure(404, '附件不存在或无权访问。');
      if (row.scan_status !== 'clean') throw failure(422, '附件尚未通过安全扫描。');
      if (!uuidPattern.test(row.blob_key)) throw failure(503, '附件存储记录无效。');
      const bytes = await readFile(join(folder, row.blob_key));
      if (createHash('sha256').update(bytes).digest('hex') !== row.hash)
        throw failure(503, '附件完整性校验失败，无法下载。');
      reply
        .header('Content-Type', 'application/octet-stream')
        .header('X-Content-Type-Options', 'nosniff')
        .header(
          'Content-Disposition',
          "attachment; filename*=UTF-8''" + encodeURIComponent(row.name),
        );
      return reply.send(bytes);
    });
  });
}
