import test from 'node:test';
import assert from 'node:assert/strict';
import { threeWayRebase } from '../../../../apps/api/src/modules/fs-workspace/changes/rebase.mjs';
import { document, block } from '../../../fixtures/fs-workspace/document.mjs';
import { contentHash } from '../../../../apps/api/src/modules/fs-workspace/document/ast.mjs';
test('three-way rebase preserves independent remote edits and reports same-block conflicts', () => {
  const base = { ast: document(), entity_manifest: [] },
    remote = structuredClone(base);
  remote.ast.revision = 2;
  remote.ast.sections[1].blocks[0].text = 'remote edit';
  const original = base.ast.sections[0].blocks[0];
  const op = {
    op: 'replace',
    entity_type: 'block',
    target_id: original.id,
    expected_revision: 1,
    before_hash: contentHash(original),
    value: { ...original, text: 'local edit' },
  };
  const clean = threeWayRebase(base, remote, [op]);
  assert.equal(clean.conflicts.length, 0);
  assert.equal(clean.operations[0].expected_revision, 2);
  assert.equal(remote.ast.sections[1].blocks[0].text, 'remote edit');
  remote.ast.sections[0].blocks[0].text = 'another remote edit';
  const conflict = threeWayRebase(base, remote, [op]);
  assert.equal(conflict.conflicts.length, 1);
  assert.equal(conflict.conflicts[0].local.text, 'local edit');
  assert.equal(conflict.conflicts[0].remote.text, 'another remote edit');
});
