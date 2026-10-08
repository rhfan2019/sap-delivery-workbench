import { randomUUID } from 'node:crypto';
import { join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transaction, failure } from '../../../platform/auth.mjs';
import { deliveryContext } from '../../delivery/context.mjs';
import { workspaceCapabilities } from '../access.mjs';
import { contentHash } from '../document/ast.mjs';
import { scanAttachment } from '../attachments/scanner.mjs';
import { parseAttachment, parserVersion } from '../attachments/parser.mjs';
import { renewLease } from './queue.mjs';
import { commitNode } from './checkpoints.mjs';
import { executeRebase } from '../changes/rebase.mjs';
import { executeExport } from '../export/worker.mjs';
import { runCapability } from './authorization.mjs';
import {executeAgent} from '../agent/worker.mjs';

export async function runOne(
  pool,
  lease,
  {
    agentInfer,
    signal,
    scannerExecutable = process.env.FS_CLAMSCAN_PATH,
    folder = process.env.FS_ATTACHMENTS_DIR ??
      fileURLToPath(new URL('../../../../../../.runtime/fs-attachments/', import.meta.url)),
  } = {},
) {
  if (
    lease.intent === 'attachment_parse' &&
    (!isAbsolute(folder) ||
      (process.env.NODE_ENV === 'production' && !process.env.FS_ATTACHMENTS_DIR))
  )
    throw new Error('Configure absolute FS_ATTACHMENTS_DIR');
  let renewing = false,
    lost = false;
  const controller=new AbortController();
  const agentSignal=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
  const timer = setInterval(async () => {
    if (renewing) return;
    renewing = true;
    try {
      if (!(await renewLease(pool, lease))) {lost = true;controller.abort();}
    } catch {
      lost = true;
      controller.abort();
    } finally {
      renewing = false;
    }
  }, 10000);
  try {
    const context = deliveryContext(pool, lease.organization_id, () => {
      throw new Error('No worker login');
    });
    try {
      const project = await context.access(
        pool,
        { user: { id: lease.principal_user_id }, sessionId: lease.principal_session_id },
        lease.project_id,
        true,
      );
      const {
        rows: [item],
      } = await pool.query(
        'SELECT i.* FROM app.fs_workspace w JOIN app.development_item i ON i.id=w.item_id WHERE w.id=$1 AND w.active',
        [lease.workspace_id],
      );
      if (
        !item ||
        !(
          await workspaceCapabilities(
            pool,
            {
              organizationId: lease.organization_id,
              projectId: lease.project_id,
              actorId: lease.principal_user_id,
            },
            item,
            project,
          )
        )[runCapability(lease)]
      )
        throw failure(403, '任务主体权限不足。');
    } catch (error) {
      if (![403, 404, 409].includes(error.statusCode)) throw error;
      return transaction(pool, (db) =>
        commitNode(db, lease, {
          inputHash: 'principal-check',
          outputRefs: [],
          configVersions: {},
          nextStatus: 'waiting_user',
        }),
      );
    }
    if (lease.intent === 'rebase') return await executeRebase(pool, lease);
    if (lease.intent === 'export') return await executeExport(pool, lease);
    if (['analyze','clarify','generate','revise','explain'].includes(lease.intent)) return await executeAgent(pool,lease,{infer:agentInfer,signal:agentSignal});
    let scan, parsed, attachment;
    if (lease.intent !== 'attachment_parse')
      scan = { state: 'failed', code: 'NODE_NOT_IMPLEMENTED' };
    else {
      ({
        rows: [attachment],
      } = await pool.query(
        'SELECT * FROM app.fs_attachment WHERE organization_id=$1 AND project_id=$2 AND workspace_id=$3 AND id=$4',
        [
          lease.organization_id,
          lease.project_id,
          lease.workspace_id,
          lease.budget_json.attachment_id,
        ],
      ));
      if (
        !attachment ||
        !/^[a-f0-9-]{36}$/i.test(attachment.blob_key) ||
        attachment.hash !== lease.budget_json.attachment_hash
      )
        scan = { state: 'failed', code: 'ATTACHMENT_UNAVAILABLE' };
      else {
        scan = await scanAttachment(join(folder, attachment.blob_key), {
          executable: scannerExecutable,
          expectedHash: attachment.hash,
        });
        if (scan.state === 'clean' && !lost)
          parsed = await parseAttachment(join(folder, attachment.blob_key), {
            mime: attachment.mime,
          });
      }
    }
    if (lost) throw failure(409, '任务租约失效。');
    const nextStatus =
      scan.state === 'rejected'
        ? 'failed'
        : scan.state !== 'clean'
          ? 'waiting_evidence'
          : parsed?.state === 'complete'
            ? 'completed'
            : 'waiting_evidence';
    const parseId = parsed ? randomUUID() : null;
    return await transaction(pool, (db) =>
      commitNode(
        db,
        lease,
        {
          inputHash: contentHash({ input: lease.budget_json, attempt: lease.attempt }),
          outputRefs: parseId ? [parseId] : [],
          configVersions: { parser: parserVersion },
          nextStatus,
        },
        async (db, run) => {
          if (attachment)
            await db.query('UPDATE app.fs_attachment SET scan_status=$2 WHERE id=$1', [
              attachment.id,
              scan.state,
            ]);
          await db.query(
            "UPDATE app.fs_run SET budget_json=budget_json || jsonb_build_object('error_code',$2::text) WHERE id=$1",
            [
              run.id,
              scan.code ??
                (parsed?.state !== 'complete'
                  ? (parsed?.warnings[0] ?? 'PARSE_UNAVAILABLE')
                  : null),
            ],
          );
          if (parsed) {
            await db.query('SELECT id FROM app.fs_attachment WHERE id=$1 FOR UPDATE', [
              attachment.id,
            ]);
            await db.query(
              `INSERT INTO app.fs_parse_result(id,organization_id,project_id,workspace_id,attachment_id,parser_version,revision,state,regions,coverage,warnings,hash)
          SELECT $1,$2,$3,$4,$5,$6,coalesce(max(revision),0)+1,$7,$8,$9,$10,$11 FROM app.fs_parse_result WHERE attachment_id=$5`,
              [
                parseId,
                run.organization_id,
                run.project_id,
                run.workspace_id,
                attachment.id,
                parserVersion,
                parsed.state,
                JSON.stringify(parsed.regions),
                { ...parsed.coverage, unread_regions: parsed.unread_regions },
                JSON.stringify(parsed.warnings),
                contentHash(parsed),
              ],
            );
          }
        },
      ),
    );
  } finally {
    clearInterval(timer);
  }
}
