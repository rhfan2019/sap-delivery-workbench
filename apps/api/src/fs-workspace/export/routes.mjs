import { readFile } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { failure } from '../../auth.mjs';
import { readContext, executeCommand, envelope, uuidPattern } from '../workspace/commands.mjs';
import { createExport, getExport, exportDto, assertCurrentExport } from './service.mjs';
import { exportFolder } from './storage.mjs';
const base = '/api/projects/:projectId/development-items/:id/fs-workspace';
export function registerExportRoutes(app, c) {
  app.post(base + '/exports', async (req, reply) => {
    const result = await executeCommand(
      c,
      req,
      'createFsExport',
      async (db, scope, workspace) => {
        const data = await createExport(db, scope, workspace, req.body);
        return { data, result_ids: [data.id] };
      },
      { head: false, capability: 'can_export' },
    );
    reply.code(202);
    return result;
  });
  app.get(base + '/exports/:exportId', async (req) => {
    const { scope } = await readContext(c, req);
    if (!uuidPattern.test(req.params.exportId)) throw failure(404, '导出不存在。');
    return envelope(req, exportDto(await getExport(c.pool, scope, req.params.exportId)));
  });
  app.get(base + '/exports/:exportId/download', async (req, reply) => {
    const { scope } = await readContext(c, req);
    if (!uuidPattern.test(req.params.exportId)) throw failure(404, '导出不存在。');
    const row = await getExport(c.pool, scope, req.params.exportId);
    if (row.status !== 'ready') throw failure(422, '导出文件尚未就绪。');
    try {
      await assertCurrentExport(c.pool, scope, row);
    } catch (error) {
      if (error.message === 'EXPORT_AUTHORITY_CHANGED')
        throw failure(422, '文档审批或发布状态已变化，请重新导出。');
      throw error;
    }
    const folder = exportFolder();
    if (
      !isAbsolute(folder) ||
      (process.env.NODE_ENV === 'production' && !process.env.FS_EXPORTS_DIR) ||
      !uuidPattern.test(row.blob_key)
    )
      throw failure(503, '导出存储未配置。');
    const bytes = await readFile(join(folder, row.blob_key));
    if (createHash('sha256').update(bytes).digest('hex') !== row.hash)
      throw failure(503, '导出文件完整性校验失败。');
    reply
      .header(
        'Content-Type',
        row.format === 'pdf'
          ? 'application/pdf'
          : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      )
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Disposition', `attachment; filename="FS-${row.id}.${row.format}"`);
    return reply.send(bytes);
  });
}
