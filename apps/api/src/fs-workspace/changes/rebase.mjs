import { randomUUID } from 'node:crypto';
import { failure, transaction } from '../../auth.mjs';
import { contentHash } from '../document/ast.mjs';
import { loadVersion } from '../document/repository.mjs';
import { loadChange, graphFor } from './service.mjs';
import { computeImpact } from './impact.mjs';
import { commitNode } from '../runs/checkpoints.mjs';
import { runDto } from '../runs/service.mjs';
import { appendRunEvent } from '../runs/events.mjs';
import { validateProposal } from '../../../../../packages/contracts/fs-workspace/index.mjs';

function targets(version) {
  const map = new Map();
  for (const section of version.ast.sections) {
    map.set(section.id, {
      value: section,
      hash: contentHash(section),
      revision: version.ast.revision,
    });
    for (const block of section.blocks)
      map.set(block.id, { value: block, hash: contentHash(block), revision: version.ast.revision });
  }
  for (const test of version.ast.tests)
    map.set(test.id, { value: test, hash: contentHash(test), revision: version.ast.revision });
  for (const entry of version.entity_manifest)
    map.set(entry.id, { value: entry, hash: entry.hash, revision: Number(entry.revision) });
  return map;
}
export function threeWayRebase(base, remote, operations) {
  const before = targets(base),
    current = targets(remote),
    rebased = [],
    conflicts = [];
  for (const operation of operations) {
    const old = before.get(operation.target_id),
      latest = current.get(operation.target_id);
    if (operation.op === 'add') {
      if (latest)
        conflicts.push({
          target_id: operation.target_id,
          base: null,
          local: operation.value,
          remote: latest.value,
        });
      else rebased.push(structuredClone(operation));
      continue;
    }
    if (!old || old.hash !== operation.before_hash || old.revision !== operation.expected_revision)
      throw failure(422, '候选前值与原始基础版本不一致。');
    if (!latest && operation.op === 'remove') continue;
    if (latest && operation.value && contentHash(operation.value) === latest.hash) continue;
    if (!latest || latest.hash !== old.hash) {
      conflicts.push({
        target_id: operation.target_id,
        base: old.value,
        local: operation.value,
        remote: latest?.value ?? null,
      });
      continue;
    }
    rebased.push({
      ...structuredClone(operation),
      before_hash: latest.hash,
      expected_revision: latest.revision,
    });
  }
  return { operations: rebased, conflicts };
}
export async function enqueueRebase(db, scope, workspace, id, input) {
  const change = await loadChange(db, scope, id);
  if (!['proposed', 'stale'].includes(change.status))
    throw failure(409, '候选已处理，不能重新合并。');
  if (input.new_base_document_version !== workspace.draft_head)
    throw failure(409, '重新合并必须使用当前草稿。');
  const target = await loadVersion(db, scope, workspace.draft_head);
  const {
    rows: [run],
  } = await db.query(
    `INSERT INTO app.fs_run(id,organization_id,project_id,workspace_id,session_id,input_snapshot_id,principal_user_id,principal_session_id,intent,status,node_id,budget_json)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,'rebase','queued','three_way_rebase',$9) RETURNING *`,
    [
      randomUUID(),
      scope.organizationId,
      scope.projectId,
      workspace.id,
      target.ast.context.session_id,
      target.ast.context.context_snapshot_id,
      scope.actorId,
      scope.sessionId,
      { change_id: id, new_base: target.id, max_attempts: 3 },
    ],
  );
  await appendRunEvent(db, run, 'run.queued', '三方重新合并已排队。');
  return runDto(run);
}
export async function executeRebase(pool, lease) {
  const scope = {
    organizationId: lease.organization_id,
    projectId: lease.project_id,
    workspaceId: lease.workspace_id,
    actorId: lease.principal_user_id,
    sessionId: lease.principal_session_id,
  };
  const change = await loadChange(pool, scope, lease.budget_json.change_id);
  if (
    !validateProposal('ChangeSet', change.proposal).ok ||
    contentHash(change.proposal) !== change.hash
  )
    throw failure(422, '候选结构或哈希无效。');
  const base = await loadVersion(pool, scope, change.base_revision_id),
    remote = await loadVersion(pool, scope, lease.budget_json.new_base);
  const merged = threeWayRebase(base, remote, change.proposal.operations),
    id = randomUUID();
  return transaction(pool, (db) =>
    commitNode(
      db,
      lease,
      {
        inputHash: contentHash({ change: change.hash, remote: remote.content_hash }),
        outputRefs: merged.conflicts.length || !merged.operations.length ? [] : [id],
        configVersions: { merge: 'three-way-v1' },
        nextStatus: merged.conflicts.length ? 'waiting_user' : 'completed',
      },
      async (db) => {
        const {
          rows: [workspace],
        } = await db.query('SELECT draft_head FROM app.fs_workspace WHERE id=$1', [
          scope.workspaceId,
        ]);
        if (workspace.draft_head !== remote.id) throw failure(409, '合并期间草稿再次变化。');
        if (merged.conflicts.length) {
          await db.query('UPDATE app.fs_run SET budget_json=budget_json || $2::jsonb WHERE id=$1', [
            lease.id,
            { error_code: 'MERGE_CONFLICT', conflicts: merged.conflicts },
          ]);
          return;
        }
        if (merged.operations.length) {
          const ids = new Set(merged.operations.map((op) => op.target_id));
          const proposal = {
            ...change.proposal,
            change_set_id: id,
            context: { ...remote.ast.context, run_id: lease.id, base_document_version: remote.id },
            operations: merged.operations,
            impacts: computeImpact(await graphFor(db, scope, remote.ast), [...ids]),
            atomic_groups: change.proposal.atomic_groups
              .map((g) => ({
                ...g,
                operation_target_ids: g.operation_target_ids.filter((target) => ids.has(target)),
              }))
              .filter((g) => g.operation_target_ids.length),
          };
          if (!validateProposal('ChangeSet', proposal).ok)
            throw failure(422, '合并后的候选未通过契约。');
          await db.query(
            "INSERT INTO app.fs_change_set(id,organization_id,project_id,workspace_id,base_revision_id,proposal,hash,status) VALUES($1,$2,$3,$4,$5,$6,$7,'proposed')",
            [
              id,
              scope.organizationId,
              scope.projectId,
              scope.workspaceId,
              remote.id,
              proposal,
              contentHash(proposal),
            ],
          );
          await appendRunEvent(
            db,
            { ...lease, status: 'completed' },
            'artifact.proposed',
            '重新合并候选已生成，仍需人工接受。',
            { entity_ids: [id] },
          );
        }
        await db.query(
          "UPDATE app.fs_change_set SET status='stale' WHERE id=$1 AND status='proposed'",
          [change.id],
        );
      },
    ),
  );
}
