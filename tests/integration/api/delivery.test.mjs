import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import ExcelJS from 'exceljs';
import { connectDatabase } from '../../../apps/api/src/platform/database.mjs';
import { digest } from '../../../apps/api/src/platform/auth.mjs';
import { createApp } from '../../../apps/api/src/app.mjs';
import { grantRole, dropOrganizations } from '../../fixtures/access.mjs';

test('development list: numbering, phases, objects, tags, custom columns, batch, Excel, archive', async () => {
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
    for (const [id, name] of [
      [user, '顾问甲'],
      [outsider, '外部人员'],
    ]) {
      await db.query('INSERT INTO app.app_user(id,login_name,display_name) VALUES($1,$2,$3)', [
        id,
        'd-' + id,
        name,
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
    // Contract 3.5: a functional consultant maintains the list but not its settings.
    await grantRole(db, org, user, 'C_FUNC', { projectId: project });
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

    // Create: required fields, numbering, defaults.
    await expect('POST', base, { name: '', module: 'MM', kind: 'report' }, 400);
    await expect('POST', base, { name: '表单', module: 'MM', kind: 'form' }, 400);
    await expect(
      'POST',
      base,
      { name: '旧字段', module: 'MM', kind: 'report', stage: 'ready' },
      400,
    );
    let item = await expect(
      'POST',
      base,
      { name: '库存报表', module: 'MM', kind: 'report', 'fsd.assigneeId': user },
      201,
    );
    assert.equal(item.code, '00001');
    assert.equal(item.priority, 'medium');
    assert.equal(item.difficulty, 'medium');
    assert.equal(item.changeType, 'new');
    assert.match(item.registeredOn, /^\d{4}-\d{2}-\d{2}$/);
    assert.deepEqual(Object.keys(item.phases), [
      'fsd',
      'development',
      'consultant_test',
      'user_test',
    ]);
    assert.equal(item.phases.fsd.assigneeId, user);
    assert.equal(item.phases.development.status, 'not_started');
    const second = await expect(
      'POST',
      base,
      { name: '销售接口', module: 'SD', kind: 'interface' },
      201,
    );
    assert.equal(second.code, '00002');

    // Rich text is sanitized; people must be active project members.
    item = await expect('PATCH', base + '/' + item.id, {
      rowVersion: item.rowVersion,
      changes: {
        businessFunction: '<p>原始需求<strong>重点</strong></p><script>alert(1)</script>',
        'development.notes': '<p>说明</p><img src=x onerror=alert(1)>',
      },
    });
    assert.equal(item.businessFunction, '<p>原始需求<strong>重点</strong></p>');
    assert.equal(item.phases.development.notes, '<p>说明</p>');
    await expect(
      'PATCH',
      base + '/' + item.id,
      { rowVersion: item.rowVersion, changes: { 'development.assigneeId': outsider } },
      400,
    );

    // Phase rules: effort precision, completed = 100%, date order, stale versions.
    await expect(
      'PATCH',
      base + '/' + item.id,
      { rowVersion: item.rowVersion, changes: { 'development.effortDays': 1.25 } },
      400,
    );
    await expect(
      'PATCH',
      base + '/' + item.id,
      { rowVersion: item.rowVersion, changes: { 'user_test.effortDays': 1 } },
      400,
    );
    await expect(
      'PATCH',
      base + '/' + item.id,
      {
        rowVersion: item.rowVersion,
        changes: { 'fsd.plannedStart': '2026-10-10', 'fsd.plannedEnd': '2026-10-01' },
      },
      400,
    );
    const stale = item.rowVersion;
    item = await expect('PATCH', base + '/' + item.id, {
      rowVersion: item.rowVersion,
      changes: {
        'development.effortDays': '2.5',
        'development.progress': 40,
        'development.status': 'in_progress',
        'fsd.status': 'completed',
      },
    });
    assert.equal(item.phases.development.effortDays, 2.5);
    assert.equal(item.phases.development.progress, 40);
    assert.equal(item.phases.fsd.progress, 100);
    await expect(
      'PATCH',
      base + '/' + item.id,
      { rowVersion: item.rowVersion, changes: { 'fsd.progress': 50 } },
      400,
    );
    await expect(
      'PATCH',
      base + '/' + item.id,
      { rowVersion: stale, changes: { name: '过时覆盖' } },
      409,
    );

    // Development objects: normalized, unique per item, shareable across items.
    await expect(
      'PATCH',
      base + '/' + item.id,
      {
        rowVersion: item.rowVersion,
        changes: {
          objects: [
            { objectType: 'prog', objectName: 'zmm_stock' },
            { pgmid: 'R3TR', objectType: 'PROG', objectName: 'ZMM_STOCK' },
          ],
        },
      },
      400,
    );
    const objects = [
      { objectType: 'prog', objectName: 'zmm_stock' },
      { pgmid: 'R3TR', objectType: 'TRAN', objectName: 'ZMM01' },
    ];
    item = await expect('PATCH', base + '/' + item.id, {
      rowVersion: item.rowVersion,
      changes: { objects, transactionCode: 'ZMM01' },
    });
    assert.deepEqual(item.objects[0], {
      pgmid: 'R3TR',
      objectType: 'PROG',
      objectName: 'ZMM_STOCK',
    });
    await expect('PATCH', base + '/' + second.id, {
      rowVersion: second.rowVersion,
      changes: { objects: [{ objectType: 'PROG', objectName: 'ZMM_STOCK' }] },
    });

    // Tags are per project and case-insensitively unique.
    const tagBase = '/api/projects/' + project + '/development-tags';
    const urgent = await expect('POST', tagBase, { name: '紧急', color: 'red' }, 201);
    await expect('POST', tagBase, { name: '紧急' }, 409);
    const phase2 = await expect('POST', tagBase, { name: 'Phase2' }, 201);
    await expect('POST', tagBase, { name: 'phase2' }, 409);
    item = await expect('PATCH', base + '/' + item.id, {
      rowVersion: item.rowVersion,
      changes: { tags: [urgent.id] },
    });
    assert.deepEqual(item.tags, [urgent.id]);
    await expect(
      'PATCH',
      base + '/' + item.id,
      { rowVersion: item.rowVersion, changes: { tags: [randomUUID()] } },
      400,
    );

    // Custom columns need delivery.config:manage; values validated against the definition.
    const fieldBase = '/api/projects/' + project + '/development-fields';
    await expect('POST', fieldBase, { label: '上线批次', fieldType: 'select' }, 403);
    await grantRole(db, org, user, 'DL_ADMIN', { projectId: project });
    await expect('POST', fieldBase, { label: '状态', fieldType: 'text' }, 400);
    await expect('POST', fieldBase, { label: '上线批次', fieldType: 'select' }, 400);
    let batch = await expect(
      'POST',
      fieldBase,
      {
        label: '上线批次',
        fieldType: 'select',
        groupKey: 'basic',
        options: [{ label: '第一批' }, { label: '第二批' }],
      },
      201,
    );
    const budget = await expect('POST', fieldBase, { label: '预算', fieldType: 'number' }, 201);
    await expect(
      'PATCH',
      base + '/' + item.id,
      { rowVersion: item.rowVersion, changes: { ['custom.' + batch.id]: 'nope' } },
      400,
    );
    item = await expect('PATCH', base + '/' + item.id, {
      rowVersion: item.rowVersion,
      changes: { ['custom.' + batch.id]: batch.options[0].id, ['custom.' + budget.id]: '12.5' },
    });
    assert.equal(item.custom[batch.id], batch.options[0].id);
    assert.equal(item.custom[budget.id], 12.5);
    item = await expect('PATCH', base + '/' + item.id, {
      rowVersion: item.rowVersion,
      changes: { ['custom.' + budget.id]: '' },
    });
    assert.ok(!(budget.id in item.custom));
    await expect(
      'PATCH',
      fieldBase + '/' + batch.id,
      { rowVersion: batch.rowVersion, options: [{ id: batch.options[0].id, label: '首批' }] },
      400,
    );
    batch = await expect('PATCH', fieldBase + '/' + batch.id, {
      rowVersion: batch.rowVersion,
      options: [...batch.options, { label: '第三批' }].map((o, i) =>
        i === 0 ? { ...o, label: '首批' } : o,
      ),
    });
    assert.equal(batch.options[0].label, '首批');
    const archived = await expect('PATCH', fieldBase + '/' + budget.id, {
      rowVersion: budget.rowVersion,
      archived: true,
    });
    assert.ok(archived.archivedAt);
    await expect(
      'PATCH',
      base + '/' + item.id,
      { rowVersion: item.rowVersion, changes: { ['custom.' + budget.id]: 1 } },
      400,
    );

    // Batch: update, tags, copy, delete; all-or-nothing.
    await expect(
      'POST',
      base + '/batch',
      { action: 'update', ids: [item.id, second.id], changes: {} },
      400,
    );
    await expect(
      'POST',
      base + '/batch',
      { action: 'update', ids: [item.id, randomUUID()], changes: { priority: 'high' } },
      409,
    );
    await expect('POST', base + '/batch', {
      action: 'update',
      ids: [item.id, second.id],
      changes: { priority: 'high', 'consultant_test.status': 'completed' },
      addTags: [phase2.id],
      removeTags: [urgent.id],
    });
    let list = await expect('GET', base);
    for (const x of list.items) {
      assert.equal(x.priority, 'high');
      assert.equal(x.phases.consultant_test.progress, 100);
      assert.deepEqual(x.tags, [phase2.id]);
    }
    assert.equal(list.tags.find((t) => t.id === phase2.id).usage, 2);
    const copies = await expect('POST', base + '/batch', {
      action: 'copy',
      ids: [second.id, item.id],
    });
    assert.equal(copies.count, 2);
    list = await expect('GET', base);
    const copy = list.items.find((x) => x.id === copies.ids[0]);
    assert.equal(copy.code, '00003');
    assert.equal(copy.name, '库存报表');
    assert.equal(copy.phases.development.effortDays, 2.5);
    assert.equal(copy.phases.development.status, 'not_started');
    assert.equal(copy.phases.development.progress, 0);
    assert.equal(copy.objects.length, 2);
    assert.equal(copy.custom[batch.id], batch.options[0].id);
    await expect('POST', base + '/batch', { action: 'delete', ids: copies.ids });
    list = await expect('GET', base);
    assert.equal(list.items.length, 2);

    // Excel: export, edit, import preview, import; rich text survives an untouched round trip.
    const exported = await request('POST', base + '/export', { ids: [item.id] });
    assert.equal(exported.statusCode, 200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(exported.rawPayload);
    const sheet = workbook.worksheets[0];
    const headers = sheet.getRow(1).values.slice(1);
    assert.equal(headers[0], '编号');
    assert.ok(headers.includes('FSD-状态'));
    assert.ok(headers.includes('上线批次'));
    assert.ok(!headers.includes('预算'));
    const col = (name) => headers.indexOf(name) + 1;
    assert.equal(sheet.getRow(2).getCell(col('编号')).value, '00001');
    assert.equal(sheet.getRow(2).getCell(col('开发-状态')).value, '进行中');
    sheet.getRow(2).getCell(col('优先级')).value = '低';
    sheet.getRow(2).getCell(col('开发人员')).value = '顾问甲';
    const added = sheet.addRow([]);
    added.getCell(col('开发名称')).value = '导入的增强';
    added.getCell(col('模块')).value = 'FICO';
    added.getCell(col('类型')).value = '增强';
    added.getCell(col('标签')).value = '新标签，Phase2';
    added.getCell(col('开发对象')).value = 'ENHO ZFI_ENH\nR3TR CLAS ZCL_FI';
    const bad = sheet.addRow([]);
    bad.getCell(col('开发名称')).value = '坏行';
    bad.getCell(col('模块')).value = 'MM';
    bad.getCell(col('类型')).value = '不存在的类型';
    let content = Buffer.from(await workbook.xlsx.writeBuffer()).toString('base64');
    const preview = await expect('POST', base + '/import/preview', { content });
    assert.equal(preview.rows.length, 3);
    assert.deepEqual(
      preview.rows.map((r) => r.action),
      ['update', 'create', 'create'],
    );
    assert.equal(preview.rows[2].errors.length, 1);
    assert.deepEqual(preview.newTags, ['新标签']);
    await expect('POST', base + '/import', { content }, 400);
    sheet.spliceRows(bad.number, 1);
    content = Buffer.from(await workbook.xlsx.writeBuffer()).toString('base64');
    const imported = await expect('POST', base + '/import', { content });
    assert.deepEqual(imported, { created: 1, updated: 1, newTags: 1 });
    list = await expect('GET', base);
    item = list.items.find((x) => x.id === item.id);
    assert.equal(item.priority, 'low');
    assert.equal(item.phases.development.assigneeId, user);
    assert.equal(item.businessFunction, '<p>原始需求<strong>重点</strong></p>');
    const created = list.items.find((x) => x.name === '导入的增强');
    assert.equal(created.code, '00005');
    assert.equal(created.objects[0].objectType, 'ENHO');
    assert.equal(created.tags.length, 2);
    const template = await request('GET', base + '/import-template');
    assert.equal(template.statusCode, 200);

    // History, attachments, preference, soft delete, archive and membership.
    const history = await expect('GET', base + '/' + item.id + '/events');
    assert.ok(history.some((e) => e.action === 'updated' && e.changes.priority));
    const file = await expect(
      'POST',
      base + '/' + item.id + '/files',
      { name: '需求.txt', content: Buffer.from('需求示例').toString('base64') },
      201,
    );
    const download = await request('GET', base + '/' + item.id + '/files/' + file.id);
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
    await expect('DELETE', base + '/' + created.id, { rowVersion: '999' }, 409);
    await expect('DELETE', base + '/' + created.id, { rowVersion: created.rowVersion });
    await expect('GET', base + '/' + created.id, undefined, 404);
    const next = await expect(
      'POST',
      base,
      { name: '编号不复用', module: 'PP', kind: 'function' },
      201,
    );
    assert.equal(next.code, '00006');
    await db.query("UPDATE app.project SET status='archived',archived_at=now() WHERE id=$1", [
      project,
    ]);
    await expect(
      'PATCH',
      base + '/' + item.id,
      { rowVersion: item.rowVersion, changes: { name: '禁止' } },
      409,
    );
    await expect('POST', tagBase, { name: '归档后' }, 409);
    assert.equal((await expect('GET', '/api/project-preference')).projectId, null);
    await db.query("UPDATE app.project_member SET status='removed' WHERE project_id=$1", [project]);
    await expect('GET', base, undefined, 404);
  } finally {
    if (app) await app.close();
    // Only exact test-owned rows and their private files are removed.
    const { unlink } = await import('node:fs/promises');
    const { resolve } = await import('node:path');
    for (const { id } of (
      await db.query('SELECT id FROM app.development_file WHERE organization_id=$1', [org])
    ).rows)
      await unlink(resolve('.runtime/delivery-files', id)).catch(() => {});
    for (const table of [
      'development_file',
      'development_event',
      'development_item_tag',
      'development_tag',
      'development_item_object',
      'development_item_phase',
      'development_item',
      'development_field',
    ])
      await db.query('DELETE FROM app.' + table + ' WHERE organization_id=$1', [org]);
    await dropOrganizations(db, [org], [user, outsider]);
    await db.end();
  }
});
