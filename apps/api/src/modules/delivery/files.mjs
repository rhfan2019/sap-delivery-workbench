import { randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { failure } from '../../platform/auth.mjs';
import { text, uuid } from '../admin/validation.mjs';
import { base } from './items.mjs';
import { deliveryFilesFolder } from './context.mjs';
export function fileRoutes(app, c) {
  const folder = deliveryFilesFolder();
  app.get(base + '/:id/files', async (req) => {
    await c.read(req);
    await c.item(c.pool, req);
    return (
      await c.pool.query(
        `SELECT f.id,f.name,f.size,f.created_at AS "createdAt",u.display_name AS "authorName" FROM app.development_file f JOIN app.app_user u ON u.id=f.created_by WHERE item_id=$1 ORDER BY f.created_at DESC`,
        [req.params.id],
      )
    ).rows;
  });
  app.post(base + '/:id/files', { bodyLimit: 7100000 }, async (req, reply) => {
    const id = randomUUID();
    let written = false;
    try {
      return await c.write(req, 'delivery.item:edit', async (db, current, project) => {
        await c.allow(db, project, await c.item(db, req), 'delivery.item:edit');
        const name = text(req.body?.name, '文件名', 200);
        if (/[\\/\x00-\x1f\x7f]/.test(name)) throw failure(400, '文件名含无效字符。');
        const content = req.body?.content;
        if (
          typeof content !== 'string' ||
          !content ||
          content.length > 6990510 ||
          content.length % 4 !== 0
        )
          throw failure(400, '文件编码无效或文件过大。');
        const bytes = Buffer.from(content, 'base64');
        if (bytes.toString('base64') !== content) throw failure(400, '文件编码无效。');
        if (!bytes.length || bytes.length > 5242880)
          throw failure(400, '文件须为 1 字节至 5 MiB。');
        await mkdir(folder, { recursive: true });
        await writeFile(join(folder, id), bytes, { flag: 'wx' });
        written = true;
        const result = await db.query(
          `INSERT INTO app.development_file(id,organization_id,project_id,item_id,name,size,checksum,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,name,size,created_at AS "createdAt"`,
          [
            id,
            c.organizationId,
            req.params.projectId,
            req.params.id,
            name,
            bytes.length,
            createHash('sha256').update(bytes).digest('hex'),
            current.user.id,
          ],
        );
        await c.event(db, req, current, 'file_added', { name });
        reply.code(201);
        return result.rows[0];
      });
    } catch (error) {
      if (written) await unlink(join(folder, id)).catch(() => {});
      throw error;
    }
  });
  // The stored file goes only after the row is gone for good; a file already missing is fine.
  app.delete(base + '/:id/files/:fileId', async (req) => {
    const removed = await c.write(req, 'delivery.item:edit', async (db, current, project) => {
      await c.allow(db, project, await c.item(db, req), 'delivery.item:edit');
      uuid(req.params.fileId);
      const { rows } = await db.query(
        'DELETE FROM app.development_file WHERE organization_id=$1 AND item_id=$2 AND id=$3 RETURNING id,name',
        [c.organizationId, req.params.id, req.params.fileId],
      );
      if (!rows[0]) throw failure(404, '附件不存在。');
      await c.event(db, req, current, 'file_removed', { name: rows[0].name });
      return rows[0];
    });
    await unlink(join(folder, removed.id)).catch(() => {});
    return { ok: true };
  });
  app.get(base + '/:id/files/:fileId', async (req, reply) => {
    await c.read(req);
    await c.item(c.pool, req);
    uuid(req.params.fileId);
    const { rows } = await c.pool.query(
      'SELECT * FROM app.development_file WHERE id=$1 AND item_id=$2',
      [req.params.fileId, req.params.id],
    );
    if (!rows[0]) throw failure(404, '附件不存在。');
    let bytes;
    try {
      bytes = await readFile(join(folder, rows[0].id));
    } catch {
      throw failure(404, '附件文件不可用，请联系管理员。');
    }
    reply
      .header('Content-Type', 'application/octet-stream')
      .header(
        'Content-Disposition',
        "attachment; filename*=UTF-8''" + encodeURIComponent(rows[0].name),
      );
    return reply.send(bytes);
  });
}
