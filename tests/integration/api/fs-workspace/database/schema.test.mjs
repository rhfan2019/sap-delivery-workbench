import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { transaction, fixture, violation } from '../../../../fixtures/fs-workspace/database.mjs';

test('cross_workspace_heads_rejected', () =>
  transaction(async (db) => {
    const s = await fixture(db);
    const template = randomUUID(),
      a = randomUUID(),
      b = randomUUID(),
      doc = randomUUID();
    await db.query(
      "INSERT INTO app.fs_template_version(id,organization_id,template_key,version,schema_version,slots,ruleset_version,renderer_version,hash) VALUES($1,$2,'five','1','1','[]','1','1','h')",
      [template, s.organizationId],
    );
    for (const id of [a, b])
      await db.query(
        "INSERT INTO app.fs_workspace(id,organization_id,project_id,item_id,fs_number,profile,template_version_id,active) VALUES($1,$2,$3,$4,'FS','report',$5,false)",
        [id, s.organizationId, s.projectId, s.itemId, template],
      );
    await db.query(
      "INSERT INTO app.fs_document_revision(id,organization_id,project_id,workspace_id,seq,template_version_id,ast,entity_manifest,evidence_manifest,content_hash,created_by) VALUES($1,$2,$3,$4,1,$5,'{}','[]','[]','h',$6)",
      [doc, s.organizationId, s.projectId, b, template, s.actorId],
    );
    await violation(
      db,
      () => db.query('UPDATE app.fs_workspace SET draft_head=$1 WHERE id=$2', [doc, a]),
      '23503',
    );
    assert.equal(
      (await db.query('SELECT draft_head FROM app.fs_workspace WHERE id=$1', [a])).rows[0]
        .draft_head,
      null,
    );
  }));

test('immutable_history_not_updatable', () =>
  transaction(async (db) => {
    await db.query('SET LOCAL ROLE sap_workbench_app');
    for (const table of [
      'fs_document_revision',
      'fs_template_version',
      'fs_entity_revision',
      'fs_confirmation',
      'fs_run_checkpoint',
      'fs_run_event',
      'fs_approval',
      'fs_publication',
      'fs_message',
      'fs_parse_result',
      'fs_evidence',
      'fs_dependency',
      'fs_context_snapshot',
      'fs_command_receipt',
      'fs_review',
      'fs_project_command_receipt',
    ]) {
      await violation(db, () => db.query(`DELETE FROM app.${table} WHERE false`), '42501');
      await violation(db, () => db.query(`UPDATE app.${table} SET id=id WHERE false`), '42501');
    }
  }));
