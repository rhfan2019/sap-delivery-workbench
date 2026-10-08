import { randomUUID, createHash } from 'node:crypto';
import { readFile, mkdir, writeFile, unlink } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import JSZip from 'jszip';
import { transaction } from '../../../platform/auth.mjs';
import { loadVersion } from '../document/repository.mjs';
import { contentHash } from '../document/ast.mjs';
import { commitNode } from '../runs/checkpoints.mjs';
import { appendRunEvent } from '../runs/events.mjs';
import { getExport, assertCurrentExport } from './service.mjs';
import { exportFolder } from './storage.mjs';
import { toRenderModel } from './render-model.mjs';
import { renderDocx } from './docx.mjs';
import { renderPdf } from './pdf.mjs';
import { parsePdfBytes } from '../attachments/parser.mjs';

function expectedText(model) {
  return [
    model.title,
    ...model.sections.flatMap((s) => [
      s.title,
      ...s.blocks.flatMap((b) => [
        b.text ?? '',
        ...b.columns,
        ...b.rows.flatMap((r) => r.cells),
        ...b.evidence_refs.flatMap((e) => [e.locator, e.conclusion, e.evidence_id]),
      ]),
    ]),
    ...model.tests.flatMap((t) => [t.title, ...t.preconditions, ...t.steps, ...t.expected]),
    ...model.evidence_ids,
  ];
}
export async function executeExport(pool, lease) {
  const scope = {
    organizationId: lease.organization_id,
    projectId: lease.project_id,
    workspaceId: lease.workspace_id,
  };
  const entry = await getExport(pool, scope, lease.budget_json.export_id),
    document = await loadVersion(pool, scope, entry.document_revision_id),
    model = toRenderModel(document.ast, document.template);
  let bytes, code, blobKey;
  try {
    await assertCurrentExport(pool, scope, entry);
    if (contentHash(model) !== entry.manifest.render_model_hash)
      throw new Error('RENDER_MODEL_CHANGED');
    if (!process.env.FS_FONT_NAME || !process.env.FS_FONT_FILE)
      throw new Error('FONT_NOT_CONFIGURED');
    const font = await readFile(process.env.FS_FONT_FILE);
    if (createHash('sha256').update(font).digest('hex') !== entry.manifest.font_pack_version)
      throw new Error('FONT_VERSION_CHANGED');
    bytes =
      entry.format === 'pdf'
        ? await renderPdf(model, entry.manifest)
        : await renderDocx(model, entry.manifest, { fontName: process.env.FS_FONT_NAME });
    let text;
    if (entry.format === 'pdf') {
      const parsed = await parsePdfBytes(bytes);
      if (parsed.state !== 'complete') throw new Error('OUTPUT_VERIFICATION_FAILED');
      text = parsed.regions.map((r) => r.text).join('');
    } else {
      const zip = await JSZip.loadAsync(bytes);
      text = (await zip.file('word/document.xml').async('string'))
        .replace(/<[^>]+>/g, '')
        .replaceAll('&lt;', '<')
        .replaceAll('&gt;', '>')
        .replaceAll('&quot;', '"')
        .replaceAll('&apos;', "'")
        .replaceAll('&amp;', '&');
    }
    const normalize = (text) => text.replace(/\s/g, '');
    if (expectedText(model).some((value) => !normalize(text).includes(normalize(value))))
      throw new Error('OUTPUT_VERIFICATION_FAILED');
    const folder = exportFolder();
    if (
      !isAbsolute(folder) ||
      (process.env.NODE_ENV === 'production' && !process.env.FS_EXPORTS_DIR)
    )
      throw new Error('EXPORT_STORAGE_UNAVAILABLE');
    await mkdir(folder, { recursive: true });
    blobKey = randomUUID();
    await writeFile(join(folder, blobKey), bytes, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    code = [
      'EXPORT_AUTHORITY_CHANGED',
      'FONT_NOT_CONFIGURED',
      'FONT_VERSION_CHANGED',
      'BROWSER_NOT_CONFIGURED',
      'RENDER_MODEL_CHANGED',
      'OUTPUT_VERIFICATION_FAILED',
      'EXPORT_STORAGE_UNAVAILABLE',
    ].includes(error.message)
      ? error.message
      : 'RENDER_FAILED';
  }
  try {
    return await transaction(pool, (db) =>
      commitNode(
        db,
        lease,
        {
          inputHash: entry.manifest_hash,
          outputRefs: code ? [] : [entry.id],
          configVersions: {
            renderer: entry.manifest.renderer_version,
            font: entry.manifest.font_pack_version,
          },
          nextStatus: code ? 'waiting_evidence' : 'completed',
        },
        async (db, run) => {
          if (code) {
            await db.query("UPDATE app.fs_export SET status='failed',error_code=$2 WHERE id=$1", [
              entry.id,
              code,
            ]);
            await db.query(
              "UPDATE app.fs_run SET budget_json=budget_json||jsonb_build_object('error_code',$2::text) WHERE id=$1",
              [run.id, code],
            );
          } else {
            await assertCurrentExport(db, scope, entry);
            await db.query(
              "UPDATE app.fs_export SET status='ready',blob_key=$2,hash=$3,error_code=NULL WHERE id=$1",
              [entry.id, blobKey, createHash('sha256').update(bytes).digest('hex')],
            );
            await appendRunEvent(
              db,
              { ...run, status: 'completed' },
              'export.ready',
              '固定版本文件已生成并完成内容核对。',
              { entity_ids: [entry.id] },
            );
          }
        },
      ),
    );
  } finally {
    if (blobKey) {
      let referenced = true;
      try {
        referenced =
          (await pool.query('SELECT id FROM app.fs_export WHERE blob_key=$1', [blobKey])).rowCount >
          0;
      } catch {
        /* Unknown commit outcome retains the private blob. */
      }
      if (!referenced) await unlink(join(exportFolder(), blobKey));
    }
  }
}
