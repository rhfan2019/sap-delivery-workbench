// Builds the virtual test project on the local application: through its API, so every rule and
// permission applies, and then rewrites this project's timestamps so history-based charts have
// weeks of data from the first day. Run with npm run seed:test-project while the API is running.
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { connectDatabase } from '@sap-delivery-workbench/api/platform/database';
import { CONTACTS, ITEMS, OWNERS, PEOPLE, TAGS } from './seed-test-project-data.mjs';

const PROJECT_CODE = 'VTEST';
const LOGIN_PREFIX = 'vtest.';
if (process.env.NODE_ENV === 'production') throw new Error('Seeding is for development only.');
const api = new URL(process.env.SEED_API_URL ?? 'http://127.0.0.1:3001');
if (!['127.0.0.1', 'localhost', '[::1]'].includes(api.hostname))
  throw new Error('Seeding only talks to a local API.');
const origin = process.env.APP_ORIGIN ?? 'http://127.0.0.1:5173';
const accountsFile = resolve(process.env.SEED_ACCOUNTS_FILE ?? '.runtime/test-accounts.txt');
const adminLogin = process.env.SEED_ADMIN_LOGIN ?? 'admin';

// Repeatable pseudo-random choices, so two runs build the same project.
let state = 20261103;
function random() {
  state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const between = (low, high) => low + Math.floor(random() * (high - low + 1));
const pick = (list) => list[Math.floor(random() * list.length)];
const chance = (share) => random() < share;

const today = new Date().toISOString().slice(0, 10);
function day(offset) {
  const date = new Date(today + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}
// A working day at or before the offset, so nothing falls on a weekend.
function workday(offset) {
  const date = new Date(day(offset) + 'T00:00:00Z');
  while ([0, 6].includes(date.getUTCDay())) date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function askPassword(prompt) {
  if (process.env.SEED_ADMIN_PASSWORD) return Promise.resolve(process.env.SEED_ADMIN_PASSWORD);
  if (!process.stdin.isTTY)
    throw new Error('Run this in a terminal so the administrator password can be typed.');
  return new Promise((done) => {
    const reader = createInterface({ input: process.stdin, output: process.stdout });
    process.stdout.write(prompt);
    // The typed characters are not echoed.
    reader._writeToOutput = () => {};
    reader.question('', (answer) => {
      reader.close();
      process.stdout.write('\n');
      done(answer);
    });
  });
}

async function request(method, path, body, cookie, expected) {
  const response = await fetch(new URL(path, api), {
    method,
    headers: {
      origin,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(cookie ? { cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  if (!response.ok || (expected && response.status !== expected))
    throw new Error(`${method} ${path} returned ${response.status}: ${text.slice(0, 400)}`);
  return { json: text ? JSON.parse(text) : null, response };
}

async function login(loginName, password) {
  const { json, response } = await request('POST', '/api/login', { loginName, password });
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
  return { cookie, json };
}

function saveAccounts(accounts) {
  mkdirSync(dirname(accountsFile), { recursive: true });
  const lines = accounts.map(
    (a) =>
      `${a.loginName}\t${a.name}\t${a.role}\t${a.password}\t${a.changed ? '可直接登录' : '首次登录需改密'}`,
  );
  writeFileSync(accountsFile, ['虚拟测试项目账号（虚构数据，不要提交）', ...lines, ''].join('\n'), {
    mode: 0o600,
  });
}

// What one item looks like today, by how far along it is.
function phasesOf(wave, spec, people) {
  const consultant = people[spec.module.toLowerCase() + '.func'];
  const developers = PEOPLE.filter(
    ([, , , role, options]) =>
      ['C_DEV', 'C_SUBCON_DEV'].includes(role) && options?.modules?.includes(spec.module),
  ).map(([suffix]) => people[suffix]);
  const developer = pick(developers);
  const tester = pick([people.test01, people.test02]);
  const fsdEffort = between(1, 4);
  const devEffort = pick([2, 3, 3, 4, 5, 5, 6, 8, 10, 12]);
  const fields = {
    'fsd.assigneeId': consultant,
    'fsd.effortDays': fsdEffort,
    'development.assigneeId': developer,
    'development.effortDays': devEffort,
    'consultant_test.assigneeId': consultant,
    'user_test.assigneeId': tester,
  };
  const set = (phase, values) => {
    for (const [key, value] of Object.entries(values)) fields[`${phase}.${key}`] = value;
  };
  const finished = (phase, end, length) => {
    const slip = pick([-2, -1, 0, 0, 0, 1, 2, 3, 5]);
    set(phase, {
      status: 'completed',
      plannedStart: workday(end - length - slip),
      plannedEnd: workday(end - slip),
      actualStart: workday(end - length),
      actualEnd: workday(end),
    });
  };
  const planned = (phase, start, end) =>
    set(phase, { plannedStart: workday(start), plannedEnd: workday(end) });
  const working = (phase, start, end, status = 'in_progress') =>
    set(phase, {
      status,
      plannedStart: workday(start),
      plannedEnd: workday(end),
      actualStart: workday(start),
      progress: between(20, 85),
    });

  let created;
  if (wave === 'tested') {
    const tested = between(-56, -2);
    const developed = tested - between(3, 9);
    const designed = developed - between(5, 14);
    created = designed - between(10, 40);
    finished('fsd', designed, fsdEffort + 2);
    finished('development', developed, devEffort + 1);
    finished('consultant_test', tested, between(2, 5));
    if (chance(0.3)) finished('user_test', Math.min(-1, tested + between(2, 20)), 3);
    else if (chance(0.45)) working('user_test', tested + 2 > -1 ? -1 : tested + 2, between(3, 20));
    else planned('user_test', between(52, 60), between(61, 90));
  } else if (wave === 'testing') {
    const developed = between(-21, -2);
    const designed = developed - between(5, 14);
    created = designed - between(10, 35);
    finished('fsd', designed, fsdEffort + 2);
    finished('development', developed, devEffort + 1);
    working(
      'consultant_test',
      developed + 1 > -1 ? -1 : developed + 1,
      between(1, 12),
      chance(0.12) ? 'delayed' : 'in_progress',
    );
    planned('user_test', between(52, 60), between(61, 90));
  } else if (wave === 'developing') {
    const start = between(-20, -3);
    const designed = start - between(1, 10);
    created = designed - between(10, 35);
    finished('fsd', designed, fsdEffort + 2);
    const roll = random();
    if (roll < 0.12) working('development', start, between(1, 10), 'delayed');
    else if (roll < 0.25) working('development', start, between(-7, -1));
    else if (roll < 0.33) working('development', start, between(47, 60));
    else working('development', start, between(2, 30));
    planned('consultant_test', between(31, 36), between(37, 44));
    planned('user_test', between(52, 60), between(61, 90));
  } else if (wave === 'designed') {
    const designed = between(-15, -1);
    created = designed - between(10, 30);
    finished('fsd', designed, fsdEffort + 2);
    if (chance(0.15)) {
      delete fields['development.assigneeId'];
      delete fields['development.effortDays'];
    } else {
      const start = between(3, 18);
      planned('development', start, start + devEffort + between(1, 5));
      planned('consultant_test', start + devEffort + 6, start + devEffort + between(9, 14));
    }
  } else if (wave === 'designing') {
    const start = between(-10, -1);
    created = start - between(3, 25);
    working('fsd', start, between(2, 15), chance(0.1) ? 'delayed' : 'in_progress');
    planned('development', between(16, 22), between(24, 40));
  } else if (wave === 'waiting') {
    created = between(-30, -1);
    if (chance(0.5)) delete fields['fsd.assigneeId'];
    if (chance(0.5)) delete fields['development.assigneeId'];
    if (chance(0.3)) delete fields['development.effortDays'];
    if (chance(0.5)) planned('fsd', between(5, 15), between(16, 22));
    if (chance(0.5)) planned('development', between(23, 30), between(31, 44));
  } else {
    created = between(-180, -100);
    for (const phase of ['fsd', 'development', 'consultant_test', 'user_test'])
      fields[`${phase}.status`] = 'cancelled';
    delete fields['fsd.effortDays'];
    delete fields['development.effortDays'];
  }
  return { fields, created };
}

const WAVES = [
  ['tested', 0.34],
  ['testing', 0.14],
  ['developing', 0.22],
  ['designed', 0.12],
  ['designing', 0.12],
  ['waiting', 0.04],
  ['cancelled', 0.02],
];

function waveAt(share) {
  let total = 0;
  for (const [wave, weight] of WAVES) {
    total += weight;
    if (share < total) return wave;
  }
  return 'waiting';
}

// The API stamps everything with the time of this run; move this project's rows to when the
// work is said to have happened. Nothing outside the project is touched.
async function rewriteHistory(project) {
  const db = await connectDatabase();
  try {
    await db.query('BEGIN');
    await db.query(
      `UPDATE app.development_item SET created_at=(registered_on::timestamp + time '09:00') AT TIME ZONE 'UTC'
       WHERE project_id=$1`,
      [project],
    );
    await db.query(
      `UPDATE app.development_phase_transition t SET at = CASE
          WHEN t.from_status IS NULL THEN i.created_at
          WHEN t.to_status='completed' THEN (COALESCE(p.actual_end,CURRENT_DATE)::timestamp + time '17:30') AT TIME ZONE 'UTC'
          WHEN t.to_status IN ('in_progress','delayed') THEN (COALESCE(p.actual_start,p.planned_start,CURRENT_DATE)::timestamp + time '10:00') AT TIME ZONE 'UTC'
          ELSE i.created_at + interval '7 days' END
       FROM app.development_item i, app.development_item_phase p
       WHERE t.project_id=$1 AND i.id=t.item_id AND p.item_id=t.item_id AND p.phase=t.phase`,
      [project],
    );
    // The creating event happened at creation; a later change (a pushed plan) in the last weeks.
    await db.query(
      `UPDATE app.development_event e SET created_at = CASE
          WHEN e.action='created' THEN i.created_at
          ELSE now() - make_interval(days => 1 + abs(hashtext(e.id::text)) % 20) END
       FROM app.development_item i WHERE e.project_id=$1 AND i.id=e.item_id`,
      [project],
    );
    await db.query(
      `UPDATE app.development_item_phase p SET updated_at = last.at
       FROM (SELECT item_id,phase,max(at) AS at FROM app.development_phase_transition
             WHERE project_id=$1 GROUP BY item_id,phase) last
       WHERE p.project_id=$1 AND p.item_id=last.item_id AND p.phase=last.phase`,
      [project],
    );
    await db.query(
      `UPDATE app.development_item i SET updated_at = GREATEST(
          (SELECT max(updated_at) FROM app.development_item_phase p WHERE p.item_id=i.id),
          (SELECT max(created_at) FROM app.development_event e WHERE e.item_id=i.id))
       WHERE i.project_id=$1`,
      [project],
    );
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    await db.end();
  }
}

try {
  const password = await askPassword(`Password of ${adminLogin} (not shown): `);
  const session = await login(adminLogin, password);
  if (session.json?.mustChangePassword)
    throw new Error(`Sign in as ${adminLogin} and change the initial password first.`);
  const call = (method, path, body, expected) =>
    request(method, path, body, session.cookie, expected).then((r) => r.json);

  // Stop before writing anything if an earlier run left this project or its accounts behind.
  const existingUsers = await call('GET', '/api/admin/users');
  const list = existingUsers.users ?? existingUsers;
  if (list.some((u) => u.loginName.startsWith(LOGIN_PREFIX)))
    throw new Error(`Accounts named ${LOGIN_PREFIX}* already exist; nothing was changed.`);
  const customers = await call('GET', '/api/admin/customers');
  const customerList = customers.customers ?? customers;
  if (customerList.some((c) => c.code === 'VTEST-CUST'))
    throw new Error('Test customer VTEST-CUST already exists; nothing was changed.');

  console.log('Creating customer and accounts...');
  const customer = await call('POST', '/api/admin/customers', {
    name: '虚构制造集团（测试）',
    code: 'VTEST-CUST',
  });
  const positions = await call('GET', '/api/admin/positions');
  const positionId = (code) => positions.find((p) => p.code === code).id;
  const people = {};
  const accounts = [];
  const demoPassword = 'Vt-' + randomBytes(15).toString('base64url');
  for (const [suffix, name, position, role, options = {}] of PEOPLE) {
    const loginName = LOGIN_PREFIX + suffix;
    const created = await call(
      'POST',
      '/api/admin/users',
      {
        loginName,
        displayName: name,
        email: `${loginName}@example.com`,
        positionId: positionId(position),
        grantPositionRoles: true,
        personType: options.contractor ? 'subcontractor' : 'employee',
        skillModules: options.modules ?? (options.module ? [options.module] : []),
      },
      201,
    );
    people[suffix] = created.user.id;
    accounts.push({ loginName, name, role, password: created.temporaryPassword, options });
    saveAccounts(accounts);
  }

  console.log('Creating project and master data...');
  const { id: projectId } = await call(
    'POST',
    '/api/admin/projects',
    {
      customerId: customer.id,
      code: PROJECT_CODE,
      name: '虚拟测试项目',
      shortName: 'VTEST',
      projectType: 'implementation',
      plannedStartDate: workday(-240),
      plannedEndDate: workday(170),
      managerId: people.pm,
    },
    201,
  );
  const base = `/api/projects/${projectId}`;
  let project = await call('GET', base);
  project = await call('PATCH', base, {
    ...project,
    status: 'active',
    methodology: 'activate',
    contractRole: 'prime',
    sapProduct: 's4_onpremise',
    sapRelease: 'S/4HANA 2023 FPS02',
    deployment: 'private_cloud',
    modules: ['FICO', 'MM', 'PP', 'SD'],
    language: 'ZH',
    namespace: 'Z',
    defaultPackage: 'ZVTEST',
    transportMethod: 'charm',
    description: '虚构的 S/4HANA 新实施项目，用于平台开发、测试和演示。所有内容均为虚构。',
  });

  const roles = await call('GET', `${base}/roles`);
  const roleId = (code) => roles.find((r) => r.code === code).id;
  const members = await call('GET', `${base}/members`);
  const already = new Set(members.map((m) => m.userId ?? m.id));
  for (const [suffix, , , role, options = {}] of PEOPLE) {
    if (already.has(people[suffix])) continue;
    const modules = options.module ? [options.module] : undefined;
    await call(
      'POST',
      `${base}/members`,
      {
        userId: people[suffix],
        roles: [
          {
            roleId: roleId(role),
            ...(modules ? { modules } : {}),
            ...(options.contractor ? { ownOnly: true, validTo: day(170) } : {}),
          },
        ],
      },
      201,
    );
  }
  project = await call('PUT', `${base}/team`, {
    keyRoles: {
      manager: people.pm,
      director: people.director,
      architect: people.architect,
      devLead: people.devlead,
      basisLead: people.basis,
    },
    moduleLeads: Object.keys(OWNERS).map((module) => ({
      module,
      userId: people[module.toLowerCase() + '.func'],
    })),
    rowVersion: project.rowVersion,
  });
  for (const contact of CONTACTS) await call('POST', `${base}/contacts`, contact);

  project = await call('GET', base);
  const plan = {
    discover: ['completed', -240, -226],
    prepare: ['completed', -225, -181],
    explore: ['completed', -180, -96],
    realize: ['in_progress', -95, 50],
    deploy: ['not_started', 51, 140],
    run: ['not_started', 141, 170],
  };
  project = await call('PUT', `${base}/phases`, {
    phases: project.phases.map((phase) => {
      const [status, start, end] = plan[phase.key];
      return {
        ...phase,
        status,
        plannedStart: workday(start),
        plannedEnd: workday(end),
        actualStart: status === 'not_started' ? null : workday(start),
        actualEnd: status === 'completed' ? workday(end) : null,
      };
    }),
  });
  const dates = {
    kickoff: [-235, -235],
    blueprint_signoff: [-100, -96],
    code_freeze: [45],
    sit_start: [52],
    sit_end: [94],
    uat_done: [122],
    cutover_start: [132],
    go_live: [140],
    hypercare_end: [170],
  };
  for (const milestone of project.milestones) {
    const [planned, achieved] = dates[milestone.key] ?? [];
    if (planned === undefined) continue;
    await call('PATCH', `${base}/milestones/${milestone.id}`, {
      ...milestone,
      plannedOn: workday(planned),
      achievedOn: achieved === undefined ? null : workday(achieved),
    });
  }
  const notes = [
    '蓝图签字后进入实现',
    '接口方案待外围厂商确认',
    '部分 FSD 评审延后一周',
    '外围接口联调排期已确认',
  ];
  for (let week = 8; week >= 0; week--) {
    const late = week <= 3;
    await call('POST', `${base}/health`, {
      reportedOn: workday(-7 * week),
      overall: late ? 'yellow' : 'green',
      schedule: late ? 'yellow' : 'green',
      scope: week === 2 ? 'yellow' : 'green',
      cost: 'green',
      quality: 'green',
      note: notes[week % notes.length],
    });
  }

  console.log('Creating SAP systems, tags and columns...');
  await call('POST', `${base}/sap-systems`, {
    name: '开发系统（虚构）',
    purpose: 'development',
    sid: 'VTD',
    sapUrl: 'https://vtest-dev.example.com:44300',
    client: '100',
    description: '虚构地址，连接测试和 SAP 工具不可用；需要时改成真实系统。',
  });
  await call('POST', `${base}/sap-systems`, {
    name: '测试系统（虚构）',
    purpose: 'test',
    sid: 'VTQ',
    sapUrl: 'https://vtest-qas.example.com:44300',
    client: '200',
    description: '虚构地址，连接测试和 SAP 工具不可用；需要时改成真实系统。',
  });
  const tags = [];
  for (const [name, color] of TAGS)
    tags.push(await call('POST', `${base}/development-tags`, { name, color }, 201));
  const batch = await call(
    'POST',
    `${base}/development-fields`,
    {
      label: '上线批次',
      fieldType: 'select',
      groupKey: 'basic',
      options: [{ label: '第一批' }, { label: '第二批' }, { label: '第三批' }],
    },
    201,
  );
  const changeNo = await call(
    'POST',
    `${base}/development-fields`,
    { label: '变更单号', fieldType: 'text', groupKey: 'basic' },
    201,
  );

  console.log(`Creating ${ITEMS.length} development items...`);
  // A stable shuffle spreads every module over every stage.
  const order = ITEMS.map((spec) => [random(), spec])
    .sort((a, b) => a[0] - b[0])
    .map(([, spec]) => spec);
  const created = [];
  let effort = 0;
  for (const [index, spec] of order.entries()) {
    const wave = waveAt(index / order.length);
    const { fields, created: createdOffset } = phasesOf(wave, spec, people);
    effort += (fields['fsd.effortDays'] ?? 0) + (fields['development.effortDays'] ?? 0);
    const body = {
      name: spec.name,
      module: spec.module,
      kind: spec.kind,
      priority: pick(['high', 'medium', 'medium', 'low']),
      difficulty: pick(['hard', 'medium', 'medium', 'easy']),
      changeType: pick(['new', 'new', 'new', 'rebuild', 'optimize']),
      registeredOn: workday(createdOffset),
      businessOwner: OWNERS[spec.module],
      businessFunction: spec.businessFunction,
      ...(spec.transactionCode ? { transactionCode: spec.transactionCode } : {}),
      objects: [
        { pgmid: 'R3TR', objectType: spec.objectType, objectName: spec.objectName },
        // A few items share an object, which the overview reports as a conflict.
        ...(index % 37 === 5
          ? [{ pgmid: 'R3TR', objectType: 'CLAS', objectName: 'ZCL_VTEST_SHARED_RULES' }]
          : []),
      ],
      tags: chance(0.45) ? [pick(tags).id] : [],
      [`custom.${batch.id}`]: pick(batch.options).id,
      ...(chance(0.2) ? { [`custom.${changeNo.id}`]: `CR-${1000 + index}` } : {}),
      ...fields,
    };
    created.push({ wave, item: await call('POST', `${base}/development-items`, body, 201) });
  }

  console.log('Pushing some plans back and adding attachments...');
  const pushable = created.filter(({ wave }) => wave === 'developing' || wave === 'designed');
  for (const { item } of pushable.filter((_, index) => index % 4 === 0)) {
    const end = item.phases?.development?.plannedEnd;
    if (!end) continue;
    const later = new Date(end + 'T00:00:00Z');
    later.setUTCDate(later.getUTCDate() + between(3, 10));
    await call('PATCH', `${base}/development-items/${item.id}`, {
      rowVersion: item.rowVersion,
      changes: { 'development.plannedEnd': later.toISOString().slice(0, 10) },
    });
  }
  for (const { item } of created.slice(0, 3)) {
    const content = `# ${item.name}\n\n虚构的需求附件，用于测试下载和助手引用。\n`;
    await call(
      'POST',
      `${base}/development-items/${item.id}/files`,
      { name: `${item.name}-需求说明.md`, content: Buffer.from(content).toString('base64') },
      201,
    );
  }

  console.log('Writing history...');
  await call('PATCH', `${base}/commercial`, {
    contractNo: 'VTEST-2026-001',
    contractModel: 'fixed',
    contractDays: 2400,
    devBudgetDays: Math.ceil(effort * 0.97),
    teamSize: PEOPLE.length,
    rowVersion: (await call('GET', base)).rowVersion,
  });
  await rewriteHistory(projectId);
  await call('POST', '/api/project-preference', { projectId });

  // Login attempts are limited, so only the accounts for each main role get a ready password.
  console.log('Preparing demo accounts...');
  for (const account of accounts.filter((a) => a.options.demo)) {
    const first = await login(account.loginName, account.password);
    await request(
      'POST',
      '/api/password',
      { currentPassword: account.password, newPassword: demoPassword },
      first.cookie,
    );
    account.password = demoPassword;
    account.changed = true;
    saveAccounts(accounts);
    const ready = await login(account.loginName, demoPassword);
    await request('POST', '/api/project-preference', { projectId }, ready.cookie);
  }
  console.log(`Done: project ${PROJECT_CODE} with ${created.length} development items.`);
  console.log(`Accounts and passwords: ${accountsFile}`);
} catch (error) {
  console.error('Seeding failed: ' + error.message);
  process.exitCode = 1;
}
