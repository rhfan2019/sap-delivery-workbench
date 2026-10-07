import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { transaction, fixture } from './fixtures/database.mjs';
import { createConversation, saveRevision } from '../../apps/api/src/abap-fsd-agent/repository.mjs';
import {
  lockWorkflow,
  applyWorkflow,
  initialWorkflow,
  readWorkflow,
  assertIdle,
} from '../../apps/api/src/abap-fsd-agent/workflow.mjs';
import { readSessionState } from '../../apps/api/src/abap-fsd-agent/session-state.mjs';
test('persisted draft approval, final approval, immutable rollback, baseline and stale generation', () =>
  transaction(async (db) => {
    const { organizationId: org, actorId: actor } = await fixture(db);
    const conversationId = await createConversation(db, org, actor, {});
    const spec = JSON.parse(
      readFileSync(
        new URL('../../packages/contracts/abap-fsd-agent/fsd/v1/r.example.json', import.meta.url),
        'utf8',
      ),
    );
    let state = initialWorkflow();
    async function generate() {
      const runId = randomUUID();
      await db.query(
        "INSERT INTO app.fsd_agent_run(id,organization_id,actor_id,conversation_id,request_id,request_hash,state,snapshot,lease_until) VALUES($1,$2,$3,$4,$5,'test','running',$6,clock_timestamp()+interval '90 seconds')",
        [
          runId,
          org,
          actor,
          conversationId,
          randomUUID(),
          { manifest: { workflow: state }, decisions: [{ question: 'old', value: 'old' }] },
        ],
      );
      const a = await saveRevision(db, {
        org,
        actor,
        conversationId,
        runId,
        spec,
        evidence: [],
        manifest: { workflow: state },
      });
      await db.query("UPDATE app.fsd_agent_run SET state='completed' WHERE id=$1", [runId]);
      state = (await lockWorkflow(db, org, actor, conversationId)).workflow;
      return a;
    }
    async function command(command, extra = {}) {
      const s = await lockWorkflow(db, org, actor, conversationId);
      const body = { command, requestId: randomUUID(), expectedVersion: state.version, ...extra };
      state = await applyWorkflow(db, s, body, actor);
      return body;
    }
    const draft = await generate();
    assert.equal(state.phase, 'draft_review');
    await assert.rejects(() =>
      applyWorkflow(
        db,
        { ...awaitSession(), workflow: state },
        { command: 'approve_draft' },
        actor,
      ),
    );
    function awaitSession() {
      return { id: conversationId, organization_id: org, selection: {} };
    }
    const approved = await command('approve_draft', {
      revisionId: draft.id,
      contentHash: draft.contentHash,
    });
    assert.equal(state.phase, 'refining');
    const replay = await applyWorkflow(
      db,
      await lockWorkflow(db, org, actor, conversationId),
      approved,
      actor,
    );
    assert.equal(replay.version, state.version);
    const final = await generate();
    assert.equal(state.phase, 'final_review');
    await command('approve_final', { revisionId: final.id, contentHash: final.contentHash });
    assert.equal(state.phase, 'completed');
    await command('rollback', { revisionId: draft.id });
    assert.equal(state.phase, 'draft_review');
    assert.equal(state.activeRevision, 3);
    assert.notEqual(state.activeRevisionId, draft.id);
    assert.equal(state.draftApproval, null);
    assert.equal(state.finalApproval, null);
    const session = await readSessionState(db, org, actor, conversationId);
    assert.equal(session.artifacts.length, 3);
    assert.equal(session.latestArtifact.id, state.activeRevisionId);
    assert.equal(session.decisions.length, 0);
    assert.equal(session.contextHistory.length, 0);
    assert.ok(session.history.length);
    const active = randomUUID();
    await db.query(
      "INSERT INTO app.fsd_agent_run(id,organization_id,actor_id,conversation_id,request_id,request_hash,state,snapshot,lease_until) VALUES($1,$2,$3,$4,$5,'test','running','{}',clock_timestamp()+interval '90 seconds')",
      [active, org, actor, conversationId, randomUUID()],
    );
    await assert.rejects(() => command('revise'), /生成正在进行/);
    await assert.rejects(
      () =>
        saveRevision(db, {
          org,
          actor,
          conversationId,
          runId: active,
          spec,
          evidence: [],
          manifest: { workflow: initialWorkflow() },
        }),
      /阶段或版本已变化/,
    );
    await db.query(
      "UPDATE app.fsd_agent_run SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
      [active],
    );
    await assertIdle(db, conversationId);
    assert.equal(
      (await db.query('SELECT state FROM app.fsd_agent_run WHERE id=$1', [active])).rows[0].state,
      'failed',
    );
    assert.equal(
      (await readWorkflow(db, await lockWorkflow(db, org, actor, conversationId))).activeRunId,
      null,
    );
  }));
