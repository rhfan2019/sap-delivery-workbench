import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { connectDatabase } from '../scripts/lib/database.mjs';
import { createApp } from '../apps/api/src/app.mjs';
import { hashPassword } from '../apps/api/src/password.mjs';
import { resolveDefaultModel } from '../apps/api/src/models/store.mjs';
import { digest } from '../apps/api/src/auth.mjs';

test('model registry: permissions, immutable versions, defaults, tests and deletion', async () => {
  const db = await connectDatabase(),
    org = randomUUID(),
    other = randomUUID(),
    users = [randomUUID(), randomUUID()];
  const suffix = org.slice(0, 8),
    pass = 'Model test passphrase!',
    secret = 'model-secret-' + suffix;
  const oldKey = process.env.LLM_CREDENTIAL_KEY;
  process.env.LLM_CREDENTIAL_KEY = 'd'.repeat(64);
  let app,
    probeFail = false;
  try {
    await db.query(
      "INSERT INTO app.organization(id,code,name) VALUES($1,$2,'Model Test'),($3,$4,'Other')",
      [org, 'M' + suffix.toUpperCase(), other, 'X' + suffix.toUpperCase()],
    );
    const hash = await hashPassword(pass);
    for (const [i, id] of users.entries()) {
      await db.query('INSERT INTO app.app_user(id,login_name,display_name) VALUES($1,$2,$3)', [
        id,
        'model' + i + '-' + suffix,
        'Model Test',
      ]);
      await db.query(
        'INSERT INTO app.user_password(user_id,password_hash,must_change_password) VALUES($1,$2,false)',
        [id, hash],
      );
      await db.query(
        'INSERT INTO app.organization_member(organization_id,user_id,access_level) VALUES($1,$2,$3)',
        [org, id, i ? 'member' : 'admin'],
      );
    }
    app = await createApp({
      organizationId: org,
      modelProbe: async (config, key) => {
        assert.equal(key, secret);
        assert.equal(config.modelId, 'model-test');
        return probeFail
          ? { status: 'failed', code: 'AUTH_FAILED', message: '提供方拒绝认证。' }
          : { status: 'passed', code: 'OK', message: '文本生成验证通过。', latencyMs: 12 };
      },
    });
    const req = (method, url, payload, cookie) =>
      app.inject({
        method,
        url,
        payload,
        remoteAddress: 'model-' + suffix,
        headers: { origin: 'http://127.0.0.1:5173', ...(cookie ? { cookie } : {}) },
      });
    app.addHook('onError', async (_req, _reply, error) => {
      if (!error.statusCode) console.error('Model test server error:', error.code, error.message);
    });
    const login = async (i) => {
      const r = await req('POST', '/api/login', {
        loginName: 'model' + i + '-' + suffix,
        password: pass,
      });
      assert.equal(r.statusCode, 200, r.body);
      return r.headers['set-cookie'].split(';')[0];
    };
    const admin = await login(0),
      member = await login(1),
      base = '/api/admin/models';
    const listing = await req('GET', base, undefined, admin);
    assert.equal(listing.statusCode, 200, listing.body);
    assert.equal((await req('GET', base)).statusCode, 401);
    assert.equal((await req('GET', base, undefined, member)).statusCode, 403);
    await assert.rejects(resolveDefaultModel(db, org), { statusCode: 409 });
    const body = {
      name: '通用模型',
      provider: '示例服务',
      protocol: 'openai_chat',
      baseUrl: 'https://api.example.com/v1',
      modelId: 'model-test',
      apiKey: secret,
      maxOutputTokens: 8192,
      timeoutSeconds: 60,
      temperature: null,
    };
    const create = await req('POST', base, body, admin);
    assert.equal(create.statusCode, 201, create.body);
    const model = create.json();
    for (const field of ['maxOutputTokens', 'timeoutSeconds', 'temperature'])
      assert.equal(Object.hasOwn(model, field), false);
    const stored = (
      await db.query('SELECT config FROM app.llm_model_version WHERE id=$1', [model.versionId])
    ).rows[0].config;
    for (const field of ['maxOutputTokens', 'timeoutSeconds', 'temperature'])
      assert.equal(Object.hasOwn(stored, field), false);
    assert.ok(!create.body.includes(secret));
    assert.ok(!create.body.includes('cipher'));
    const path = base + '/' + model.id;
    assert.equal(
      (
        await req(
          'POST',
          path + '/default',
          { rowVersion: model.rowVersion, defaultRevision: '0' },
          admin,
        )
      ).statusCode,
      409,
    );
    const tested = await req('POST', path + '/test', { rowVersion: model.rowVersion }, admin);
    assert.equal(tested.statusCode, 200, tested.body);
    assert.equal(tested.json().status, 'passed');
    await db.query(
      "UPDATE app.llm_test_run SET expires_at=clock_timestamp()-interval '1 second' WHERE organization_id=$1",
      [org],
    );
    assert.equal(
      (
        await req(
          'POST',
          path + '/default',
          { rowVersion: model.rowVersion, defaultRevision: '0' },
          admin,
        )
      ).statusCode,
      409,
    );
    await req('POST', path + '/test', { rowVersion: model.rowVersion }, admin);
    const def = await req(
      'POST',
      path + '/default',
      { rowVersion: model.rowVersion, defaultRevision: '0' },
      admin,
    );
    assert.equal(def.statusCode, 200, def.body);
    assert.equal(
      (await req('DELETE', path, { rowVersion: model.rowVersion }, admin)).statusCode,
      409,
    );
    const update = await req(
      'PATCH',
      path,
      { ...body, apiKey: '', name: '通用模型 v2', rowVersion: model.rowVersion },
      admin,
    );
    assert.equal(update.statusCode, 200, update.body);
    const latest = update.json();
    assert.notEqual(latest.versionId, model.versionId);
    let list = (await req('GET', base, undefined, admin)).json();
    assert.equal(list.defaultModel.versionId, model.versionId);
    const resolved = await resolveDefaultModel(db, org);
    assert.equal(resolved.versionId, model.versionId);
    assert.equal(resolved.config.name, '通用模型');
    assert.equal('apiKey' in resolved, false);
    await assert.rejects(resolveDefaultModel(db, org, ['vision']), { statusCode: 409 });
    await db.query(
      "UPDATE app.llm_test_run SET expires_at=clock_timestamp()-interval '1 second' WHERE organization_id=$1 AND version_id=$2",
      [org, model.versionId],
    );
    await assert.rejects(resolveDefaultModel(db, org), { statusCode: 409 });
    assert.equal(
      (await req('PATCH', path, { ...body, rowVersion: model.rowVersion }, admin)).statusCode,
      409,
    );
    assert.equal(
      (
        await req(
          'POST',
          path + '/default',
          { rowVersion: latest.rowVersion, defaultRevision: list.defaultRevision },
          admin,
        )
      ).statusCode,
      409,
    );
    probeFail = true;
    const failed = await req('POST', path + '/test', { rowVersion: latest.rowVersion }, admin);
    assert.equal(failed.json().status, 'failed');
    assert.ok(!failed.body.includes(secret));
    probeFail = false;
    await req('POST', path + '/test', { rowVersion: latest.rowVersion }, admin);
    const otherModel = (await req('POST', base, { ...body, name: '备用' }, admin)).json();
    await req(
      'POST',
      base + '/' + otherModel.id + '/test',
      { rowVersion: otherModel.rowVersion },
      admin,
    );
    const races = await Promise.all(
      [latest, otherModel].map((m) =>
        req(
          'POST',
          base + '/' + m.id + '/default',
          { rowVersion: m.rowVersion, defaultRevision: list.defaultRevision },
          admin,
        ),
      ),
    );
    assert.deepEqual(races.map((r) => r.statusCode).sort(), [200, 409]);
    list = (await req('GET', base, undefined, admin)).json();
    const disposable = list.defaultModel.id === model.id ? otherModel : latest;
    assert.equal(
      (
        await req(
          'DELETE',
          base + '/' + disposable.id,
          { rowVersion: disposable.rowVersion },
          admin,
        )
      ).statusCode,
      200,
    );
    assert.equal(
      (
        await req(
          'POST',
          base + '/' + disposable.id + '/test',
          { rowVersion: disposable.rowVersion },
          admin,
        )
      ).statusCode,
      404,
    );
    assert.equal(
      (await req('PATCH', base + '/' + randomUUID(), { ...body, rowVersion: '1' }, admin))
        .statusCode,
      404,
    );
    const creds = (
      await db.query('SELECT secret_cipher FROM app.llm_credential WHERE organization_id=$1', [org])
    ).rows;
    assert.ok(creds.length);
    assert.ok(
      creds.every((c) => c.secret_cipher.startsWith('v1.') && !c.secret_cipher.includes(secret)),
    );
    await assert.rejects(
      db.query(
        'INSERT INTO app.llm_default(organization_id,model_id,version_id) VALUES($1,$2,$3)',
        [other, model.id, model.versionId],
      ),
      { code: '23503' },
    );
    const runtime = await connectDatabase({ runtime: true });
    try {
      await assert.rejects(
        runtime.query('UPDATE app.llm_model_version SET config=config WHERE false'),
        { code: '42501' },
      );
    } finally {
      await runtime.end();
    }
    assert.equal(
      (
        await db.query('SELECT count(*)::int n FROM app.llm_model_version WHERE model_id=$1', [
          model.id,
        ])
      ).rows[0].n,
      2,
    );
  } finally {
    await app?.close();
    for (const table of [
      'llm_default',
      'llm_test_run',
      'llm_model_version',
      'llm_model',
      'llm_credential',
    ]) {
      if ((await db.query('SELECT to_regclass($1) AS name', ['app.' + table])).rows[0].name) {
        if (table === 'llm_model_version')
          await db.query(
            'UPDATE app.llm_model SET latest_version_id=NULL WHERE organization_id=$1',
            [org],
          );
        await db.query('DELETE FROM app.' + table + ' WHERE organization_id=$1', [org]);
      }
    }
    await db.query('DELETE FROM app.audit_event WHERE organization_id=$1', [org]);
    await db.query('DELETE FROM app.auth_session WHERE organization_id=$1', [org]);
    await db.query('DELETE FROM app.organization_member WHERE organization_id=$1', [org]);
    await db.query('DELETE FROM app.user_password WHERE user_id=ANY($1::uuid[])', [users]);
    await db.query('DELETE FROM app.app_user WHERE id=ANY($1::uuid[])', [users]);
    await db.query('DELETE FROM app.organization WHERE id=ANY($1::uuid[])', [[org, other]]);
    await db.query('DELETE FROM app.login_throttle WHERE key_hash=ANY($1::bytea[])', [
      [digest('model-' + suffix), digest('model0-' + suffix), digest('model1-' + suffix)],
    ]);
    await db.end();
    if (oldKey === undefined) delete process.env.LLM_CREDENTIAL_KEY;
    else process.env.LLM_CREDENTIAL_KEY = oldKey;
  }
});
