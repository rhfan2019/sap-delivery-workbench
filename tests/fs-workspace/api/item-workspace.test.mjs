import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { apiFixture } from '../fixtures/api.mjs';
import { saveModel } from '../../../apps/api/src/models/store.mjs';
import { readFile } from 'node:fs/promises';

test('stage drafts persist independently, preserve history, reject conflicts and pin design versions', async () => {
  const f = await apiFixture();
  const base = f.base.replace('/fs-workspace', '/work/');
  const req = (method, path, payload) =>
    f.app.inject({ method, url: base + path, payload, headers: f.headers });
  try {
    let r = await req('POST', 'design', {});
    assert.equal(r.statusCode, 200, r.body);
    const first = r.json();
    assert.equal(first.canEdit, true);
    assert.match(first.head.document.notes, /保留原文/);
    r = await req('PATCH', 'design', {
      baseVersionId: first.head.id,
      document: { ...first.head.document, notes: '人工修改的新需求' },
    });
    assert.equal(r.statusCode, 200, r.body);
    const design = r.json();
    assert.notEqual(design.head.id, first.head.id);
    assert.equal(
      (
        await req('PATCH', 'design', {
          baseVersionId: first.head.id,
          document: first.head.document,
        })
      ).statusCode,
      409,
    );
    assert.equal(
      (
        await req('PATCH', 'design', {
          baseVersionId: design.head.id,
          document: design.head.document,
          sourceArtifactId: randomUUID(),
        })
      ).statusCode,
      400,
    );
    r = await req('GET', 'design/versions/' + first.head.id);
    assert.equal(r.statusCode, 200, r.body);
    assert.match(r.json().document.notes, /保留原文/);
    r = await req('POST', 'development', {});
    assert.equal(r.statusCode, 200, r.body);
    let dev = r.json();
    assert.equal(dev.head.designVersionId, null);
    r = await req('PATCH', 'development', {
      baseVersionId: dev.head.id,
      designVersionId: design.head.id,
      document: { ...dev.head.document, code: 'REPORT ztest.' },
    });
    assert.equal(r.statusCode, 200, r.body);
    dev = r.json();
    assert.equal(dev.head.designVersionId, design.head.id);
    await req('PATCH', 'design', {
      baseVersionId: design.head.id,
      document: { ...design.head.document, notes: '设计又改了' },
    });
    r = await req('GET', 'development');
    assert.equal(r.json().head.designVersionId, design.head.id);
    assert.equal(r.json().designChanged, true);
    assert.equal(r.json().head.document.code, 'REPORT ztest.');
    assert.equal((await req('GET', 'development/versions/' + design.head.id)).statusCode, 404);
    assert.equal(
      (
        await req('PATCH', 'development', {
          baseVersionId: dev.head.id,
          designVersionId: randomUUID(),
          document: dev.head.document,
        })
      ).statusCode,
      404,
    );
    const foreign = await f.app.inject({
      method: 'GET',
      url: base.replace(f.scope.itemId, randomUUID()) + 'design',
      headers: f.headers,
    });
    assert.equal(foreign.statusCode, 404);
  } finally {
    await f.close();
  }
});
