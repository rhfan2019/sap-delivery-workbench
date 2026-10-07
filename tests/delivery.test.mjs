import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { connectDatabase } from '../scripts/lib/database.mjs';
import { digest } from '../apps/api/src/auth.mjs';
import { createApp } from '../apps/api/src/app.mjs';

test('delivery: project scope, field concurrency, FS baselines, attachments and archive', async () => {
  const db = await connectDatabase();
  const org = randomUUID(),
    user = randomUUID(),
    outsider = randomUUID(),
    customer = randomUUID();
  const project = randomUUID(),
    hidden = randomUUID();
  const token = randomBytes(32).toString('hex');
  let app;
  try {
    await db.query('INSERT INTO app.organization(id,code,name) VALUES($1,$2,$3)', [
      org,
      'D' + org.slice(0, 8).toUpperCase(),
      'Delivery test',
    ]);
    for (const id of [user, outsider]) {
      await db.query('INSERT INTO app.app_user(id,login_name,display_name) VALUES($1,$2,$3)', [
        id,
        'd-' + id,
        '顾问',
      ]);
      await db.query(
        "INSERT INTO app.user_password(user_id,password_hash,must_change_password) VALUES($1,'unused-test-hash',false)",
        [id],
      );
      await db.query('INSERT INTO app.organization_member(organization_id,user_id) VALUES($1,$2)', [
        org,
        id,
      ]);
    }
    await db.query(
      "INSERT INTO app.customer(id,organization_id,code,name) VALUES($1,$2,'C','客户')",
      [customer, org],
    );
    for (const id of [project, hidden])
      await db.query(
        'INSERT INTO app.project(id,organization_id,customer_id,code,name) VALUES($1,$2,$3,$4,$5)',
        [id, org, customer, id.slice(0, 8).toUpperCase(), '测试项目'],
      );
    await db.query(
      'INSERT INTO app.project_member(organization_id,project_id,user_id) VALUES($1,$2,$3)',
      [org, project, user],
    );
    await db.query(
      "INSERT INTO app.auth_session(organization_id,user_id,token_hash,idle_expires_at,expires_at) VALUES($1,$2,$3,now()+interval '30 minutes',now()+interval '8 hours')",
      [org, user, digest(token)],
    );
    app = await createApp({ organizationId: org });
    const request = (method, url, payload) =>
      app.inject({
        method,
        url,
        payload,
        headers: { origin: 'http://127.0.0.1:5173', cookie: 'sapwb_local_session=' + token },
      });
    const base = '/api/projects/' + project + '/development-items';
    const expect = async (method, url, body, status = 200) => {
      const r = await request(method, url, body);
      assert.equal(r.statusCode, status, r.body);
      return r.json();
    };
    assert.equal((await app.inject({ method: 'GET', url: base })).statusCode, 401);
    await expect('GET', '/api/projects/' + hidden + '/development-items', undefined, 404);
    await expect('POST', base, { name: '', module: 'MM', kind: 'report' }, 400);
    let item = await expect(
      'POST',
      base,
      { name: '库存报表', module: 'MM', kind: 'report', businessOwnerId: user },
      201,
    );
    assert.match(item.code, /^DEV-/);
    assert.equal(item.priority, 'low');
    assert.equal(item.changeType, 'new');
    assert.equal(item.summaryFormat, 'plain');
    item = await expect('PATCH', base + '/' + item.id, {
      rowVersion: item.rowVersion,
      changes: {
        summaryFormat: 'html',
        summary: '<p>原始需求<strong>重点</strong></p><script>alert(1)</script>',
      },
    });
    assert.equal(item.summaryFormat, 'html');
    assert.equal(item.summary, '<p>原始需求<strong>重点</strong></p>');
    item = await expect('PATCH', base + '/' + item.id, {
      rowVersion: item.rowVersion,
      changes: { summary: '<p>更新</p><img src=x onerror=alert(1)>' },
    });
    assert.equal(item.summary, '<p>更新</p>');
    assert.equal((await expect('GET', base + '/' + item.id)).summaryFormat, 'html');
    await expect(
      'PATCH',
      base + '/' + item.id,
      { rowVersion: item.rowVersion, changes: { developerId: outsider } },
      400,
    );
    item = await expect('PATCH', base + '/' + item.id, {
      rowVersion: item.rowVersion,
      changes: { summary: '业务场景'.repeat(2000) },
    });
    const initial = item.rowVersion;
    item = await expect('PATCH', base + '/' + item.id, {
      rowVersion: initial,
      changes: { developerId: user, plannedDevDate: '2026-10-09' },
    });
    assert.equal(item.plannedDevDate, '2026-10-09');
    await expect(
      'PATCH',
      base + '/' + item.id,
      { rowVersion: initial, changes: { name: '过时覆盖' } },
      409,
    );
    await expect(
      'PATCH',
      base + '/' + item.id,
      { rowVersion: item.rowVersion, changes: { stage: 'tested' } },
      400,
    );
    await expect(
      'PATCH',
      base + '/' + item.id,
      { rowVersion: item.rowVersion, changes: { plannedDevDate: '2026-02-30' } },
      400,
    );
    assert.equal((await expect('GET', base)).items[0].name, '库存报表');
    await expect(
      'GET',
      '/api/projects/' + hidden + '/development-items/' + item.id,
      undefined,
      404,
    );
    await db.query(
      'INSERT INTO app.project_member(organization_id,project_id,user_id) VALUES($1,$2,$3)',
      [org, project, outsider],
    );
    const otherToken = randomBytes(32).toString('hex');
    await db.query(
      "INSERT INTO app.auth_session(organization_id,user_id,token_hash,idle_expires_at,expires_at) VALUES($1,$2,$3,now()+interval '30 minutes',now()+interval '8 hours')",
      [org, outsider, digest(otherToken)],
    );
    const denied = await app.inject({
      method: 'PATCH',
      url: base + '/' + item.id + '/fs',
      headers: { origin: 'http://127.0.0.1:5173', cookie: 'sapwb_local_session=' + otherToken },
      payload: { rowVersion: '1', fsNumber: 'INVALID', sections: {} },
    });
    assert.equal(
      denied.statusCode,
      403,
      'project membership alone must not allow editing another owner FS',
    );
    let fs = await expect('GET', base + '/' + item.id + '/fs');
    assert.equal(fs.versions.length, 0);
    fs = await expect('PATCH', base + '/' + item.id + '/fs', {
      rowVersion: fs.rowVersion,
      fsNumber: 'FS-LARGE',
      sections: Object.fromEntries(
        [
          'background',
          'scope',
          'inputs',
          'rules',
          'outputs',
          'authorization',
          'exceptions',
          'acceptance',
          'cases',
        ].map((k) => [k, '中'.repeat(30000)]),
      ),
    });
    const old = fs.rowVersion;
    fs = await expect('PATCH', base + '/' + item.id + '/fs', {
      rowVersion: fs.rowVersion,
      fsNumber: 'FS-MM-001',
      sections: {
        background: '库存分析',
        rules: '零库存不显示',
        acceptance: '核对结果',
        cases: '正常、零库存与权限案例',
      },
    });
    await expect(
      'PATCH',
      base + '/' + item.id + '/fs',
      { rowVersion: old, fsNumber: 'stale', sections: {} },
      409,
    );
    const version = await expect(
      'POST',
      base + '/' + item.id + '/fs/versions',
      { rowVersion: fs.rowVersion, note: '初版' },
      201,
    );
    assert.equal(version.sections.rules, '零库存不显示');
    fs = await expect('GET', base + '/' + item.id + '/fs');
    await expect('POST', base + '/' + item.id + '/fs/submit', {
      rowVersion: fs.rowVersion,
      itemVersion: item.rowVersion,
    });
    item = await expect('GET', base + '/' + item.id);
    assert.equal(item.stage, 'ready');
    fs = await expect('GET', base + '/' + item.id + '/fs');
    const submitted = fs.submittedVersionId;
    fs = await expect('PATCH', base + '/' + item.id + '/fs', {
      rowVersion: fs.rowVersion,
      fsNumber: 'FS-MM-001',
      sections: { rules: '新草稿' },
    });
    assert.equal(fs.submittedVersionId, submitted);
    assert.equal(fs.versions.find((v) => v.id === submitted).sections.rules, '零库存不显示');
    await expect(
      'POST',
      base + '/' + item.id + '/files',
      { name: 'large.txt', content: Buffer.alloc(5242880, 65).toString('base64') },
      201,
    );
    const file = await expect(
      'POST',
      base + '/' + item.id + '/files',
      { name: '需求.txt', content: Buffer.from('需求示例').toString('base64') },
      201,
    );
    const download = await request('GET', base + '/' + item.id + '/files/' + file.id);
    assert.equal(download.statusCode, 200);
    assert.equal(download.body, '需求示例');
    await expect(
      'GET',
      '/api/projects/' + hidden + '/development-items/' + item.id + '/files/' + file.id,
      undefined,
      404,
    );
    await expect('POST', '/api/project-preference', { projectId: project });
    assert.equal((await expect('GET', '/api/project-preference')).projectId, project);
    await expect('POST', '/api/project-preference', { projectId: hidden }, 404);
    const disposable = await expect(
      'POST',
      base,
      { name: '软删除测试', module: 'MM', kind: 'report' },
      201,
    );
    await expect('DELETE', base + '/' + disposable.id, { rowVersion: '999' }, 409);
    await expect(
      'DELETE',
      '/api/projects/' + hidden + '/development-items/' + disposable.id,
      { rowVersion: disposable.rowVersion },
      404,
    );
    await expect('DELETE', base + '/' + disposable.id, { rowVersion: disposable.rowVersion });
    assert.ok(!(await expect('GET', base)).items.some((x) => x.id === disposable.id));
    await expect('GET', base + '/' + disposable.id, undefined, 404);
    await expect('GET', base + '/' + disposable.id + '/fs', undefined, 404);
    const retained = await db.query('SELECT deleted_at FROM app.development_item WHERE id=$1', [
      disposable.id,
    ]);
    assert.ok(retained.rows[0].deleted_at);
    assert.equal(
      (
        await db.query('SELECT count(*)::int AS n FROM app.fs_draft WHERE item_id=$1', [
          disposable.id,
        ])
      ).rows[0].n,
      1,
    );
    await db.query("UPDATE app.project SET status='archived',archived_at=now() WHERE id=$1", [
      project,
    ]);
    await expect(
      'PATCH',
      base + '/' + item.id,
      { rowVersion: item.rowVersion, changes: { name: '禁止' } },
      409,
    );
    await expect(
      'PATCH',
      base + '/' + item.id + '/fs',
      { rowVersion: fs.rowVersion, sections: {} },
      409,
    );
    assert.equal((await expect('GET', '/api/project-preference')).projectId, null);
    await db.query("UPDATE app.project_member SET status='removed' WHERE project_id=$1", [project]);
    await expect('GET', base, undefined, 404);
  } finally {
    if (app) await app.close();
    // Only exact test-owned rows and their private files are removed.
    const tables = [
      'development_file',
      'fs_version',
      'fs_draft',
      'development_event',
      'development_item',
      'project_preference',
    ];
    for (const table of tables) {
      const exists = await db.query('SELECT to_regclass($1) AS name', ['app.' + table]);
      if (exists.rows[0].name) {
        if (table === 'development_file') {
          const { unlink } = await import('node:fs/promises');
          const { resolve } = await import('node:path');
          for (const { id } of (
            await db.query('SELECT id FROM app.development_file WHERE organization_id=$1', [org])
          ).rows)
            await unlink(resolve('.runtime/delivery-files', id)).catch(() => {});
        }
        await db.query('DELETE FROM app.' + table + ' WHERE organization_id=$1', [org]);
      }
    }
    for (const table of [
      'audit_event',
      'auth_session',
      'project_member',
      'project',
      'customer',
      'organization_member',
    ])
      await db.query('DELETE FROM app.' + table + ' WHERE organization_id=$1', [org]);
    await db.query('DELETE FROM app.user_password WHERE user_id=ANY($1::uuid[])', [
      [user, outsider],
    ]);
    await db.query('DELETE FROM app.app_user WHERE id=ANY($1::uuid[])', [[user, outsider]]);
    await db.query('DELETE FROM app.organization WHERE id=$1', [org]);
    await db.end();
  }
});
