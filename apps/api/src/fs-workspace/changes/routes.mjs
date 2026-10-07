import { executeCommand, readContext, envelope } from '../workspace/commands.mjs';
import { loadChange, proposeManualEdit, acceptChange } from './service.mjs';
import { restoreVersion } from './restore.mjs';
import { failure } from '../../auth.mjs';
import { confirmSubject } from '../document/confirmations.mjs';
import {enqueueRebase} from './rebase.mjs';
const base = '/api/projects/:projectId/development-items/:id/fs-workspace';
export function registerChangeRoutes(app, c) {
  app.post(base+'/changes/:changeId/rebase',async(req,reply)=>{
    const result=await executeCommand(c,req,'rebaseFsChange',async(db,scope,workspace)=>{const data=await enqueueRebase(db,scope,workspace,req.params.changeId,req.body);return {data,result_ids:[data.id]};},{head:false});reply.code(202);return result;
  });
  app.post(base + '/manual-edits', { bodyLimit: 1700000 }, async (req, reply) => {
    const result = await executeCommand(
      c,
      req,
      'proposeFsManualEdit',
      async (db, scope, workspace) => {
        const proposal = await proposeManualEdit(db, scope, workspace, req.body);
        return { data: proposal, result_ids: [proposal.change_set_id] };
      },
    );
    reply.code(201);
    return result;
  });
  app.get(base + '/changes/:changeId', async (req) => {
    const { scope, workspace } = await readContext(c, req);
    return envelope(
      req,
      (await loadChange(c.pool, scope, req.params.changeId)).proposal,
      String(workspace.row_version),
    );
  });
  app.post(base + '/changes/:changeId/accept', (req) =>
    executeCommand(c, req, 'acceptFsChange', async (db, scope, workspace) => {
      const result = await acceptChange(db, scope, workspace, req.params.changeId, req.body);
      return { data: result, result_ids: [req.params.changeId, result.draft_head.id] };
    }),
  );
  app.post(base + '/changes/:changeId/reject', (req) =>
    executeCommand(
      c,
      req,
      'rejectFsChange',
      async (db, scope) => {
        const change = await loadChange(db, scope, req.params.changeId);
        if (change.status !== 'proposed') throw failure(409, '变更已处理。');
        await db.query("UPDATE app.fs_change_set SET status='rejected' WHERE id=$1", [change.id]);
        return { data: { change_id: change.id, status: 'rejected' }, result_ids: [change.id] };
      },
      { head: false },
    ),
  );
  app.post(base + '/restore', (req) =>
    executeCommand(c, req, 'restoreFsVersion', async (db, scope, workspace) => {
      const result = await restoreVersion(db, scope, workspace, req.body);
      return { data: result, result_ids: [result.draft_head.id] };
    }),
  );
  app.post(base + '/confirmations', async (req, reply) => {
    const result = await executeCommand(
      c,
      req,
      'confirmFsDecision',
      async (db, scope, workspace) => {
        const data = await confirmSubject(db, scope, workspace, req.body);
        return { data, result_ids: [data.confirmation_id, data.workspace.draft_head.id] };
      },
      { capability: 'can_confirm' },
    );
    reply.code(201);
    return result;
  });
}
