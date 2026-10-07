import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeBatch } from '../lib/runner.mjs';
import { readJson, saveJson } from '../lib/storage.mjs';
const projectId = '00000000-0000-4000-8000-000000000001';
function mock() {
  const source = [
    { id: 's1', code: 'DEV-0007', rowVersion: '1' },
    { id: 's2', code: 'DEV-0002', rowVersion: '1' },
  ];
  const calls = [],
    byRequest = new Map(),
    runs = new Map();
  let copies = 0;
  const client = {
    request: async (path, body) => {
      calls.push({ path, body });
      if (path.endsWith('/development-items')) return { items: source };
      if (path.endsWith('/s1') || path.endsWith('/s2'))
        return source.find((s) => path.endsWith('/' + s.id));
      if (path.endsWith('/test-copy')) {
        copies++;
        return {
          id: path.includes('/s1/') ? 'c1' : 'c2',
          code: body.prefix + (path.includes('/s1/') ? 'DEV-0007' : 'DEV-0002'),
          rowVersion: '1',
        };
      }
      if (path.endsWith('/work/design')) return {};
      if (path.endsWith('/models'))
        return {
          defaultModel: { id: 'm' },
          items: [{ id: 'm', rowVersion: '1', modelId: 'default' }],
        };
      if (path.includes('/by-request/'))
        return byRequest.get(path.split('/').at(-1)) ?? { runId: null };
      if (path.endsWith('/runs')) {
        const n = runs.size + 1,
          runId = 'r' + n,
          conversationId = 'conv' + n;
        const result = {
          runId,
          conversationId,
          state: 'completed',
          snapshot: { input: { selection: body.selection } },
          artifact: { id: 'a' + n },
        };
        runs.set(runId, result);
        byRequest.set(body.requestId, { runId, conversationId });
        return { runId, conversationId };
      }
      if (path.endsWith('/trace')) return { events: [] };
      if (path.endsWith('/workflow'))
        return {
          phase: 'final_review',
          activeArtifact: { id: 'a', spec: { title: 'x' }, markdown: '# FSD' },
        };
      if (path.includes('/runs/')) return runs.get(path.split('/').at(-1));
      throw Error('Unexpected ' + path);
    },
    stream: async () => {
      throw Error('Completed runs should not stream');
    },
  };
  return {
    client,
    calls,
    get copies() {
      return copies;
    },
    runs,
    byRequest,
  };
}
test('sequential cases have no shared history/conversation and resume skips completed cases', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fsd-batch-'));
  try {
    const m = mock(),
      config = { projectId, codes: ['DEV-0007', 'DEV-0002'] };
    const s = await executeBatch({ client: m.client, config, dir, log() {} });
    assert.equal(s.status, 'completed');
    assert.equal(m.copies, 2);
    const starts = m.calls.filter((c) => c.path.endsWith('/runs'));
    assert.equal(starts.length, 2);
    for (const c of starts) {
      assert.deepEqual(c.body.messages, []);
      assert.equal(c.body.conversationId, undefined);
    }
    assert.notEqual(starts[0].body.selection.itemId, starts[1].body.selection.itemId);
    await executeBatch({ client: m.client, config, dir, log() {} });
    assert.equal(m.copies, 2);
    assert.equal(m.calls.filter((c) => c.path.endsWith('/runs')).length, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('unknown create response is recovered by persisted request ID without re-generation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fsd-resume-'));
  try {
    const m = mock(),
      config = { projectId, codes: ['DEV-0007'] };
    let lost = true;
    const request = m.client.request;
    m.client.request = async (p, b) => {
      const r = await request(p, b);
      if (p.endsWith('/runs') && lost) {
        lost = false;
        throw Error('network lost after commit');
      }
      return r;
    };
    await assert.rejects(executeBatch({ client: m.client, config, dir, log() {} }), /network lost/);
    assert.ok(readJson(join(dir, 'state.json')).cases[0].pending);
    const s = await executeBatch({ client: m.client, config, dir, log() {} });
    assert.equal(s.status, 'completed');
    assert.equal(m.runs.size, 1);
    assert.equal(m.copies, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
