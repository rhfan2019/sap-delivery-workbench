import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { connectDatabase } from './lib/database.mjs';
import { parseReportCases, requirementHtml } from './lib/report-cases.mjs';
import { fields } from '../apps/api/src/delivery/validation.mjs';
const sourcePath = process.argv[2];
const apply = process.argv.includes('--apply');
if (!sourcePath)
  throw new Error(
    'Usage: node --env-file=.env scripts/import-report-cases.mjs <source.txt> [--apply]',
  );
const source = await readFile(sourcePath, 'utf8'),
  cases = parseReportCases(source);
const sha = createHash('sha256').update(source).digest('hex');
if (
  cases.length !== 20 ||
  ['MM', 'SD', 'PP', 'FICO'].some((m) => cases.filter((c) => c.module === m).length !== 5)
)
  throw new Error('Expected exactly 20 cases, five per module');
const db = await connectDatabase();
try {
  await db.query('BEGIN');
  const org = process.env.DEFAULT_ORGANIZATION_ID;
  await db.query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))', [org]);
  const projects = (
    await db.query(
      "SELECT id FROM app.project WHERE organization_id=$1 AND name='虚拟测试项目' AND status<>'archived' FOR UPDATE",
      [org],
    )
  ).rows;
  if (projects.length !== 1) throw new Error('Expected one writable 虚拟测试项目');
  const project = projects[0].id;
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,1))', [project]);
  const actors = (
    await db.query(
      "SELECT u.id FROM app.project_member pm JOIN app.organization_member om USING(organization_id,user_id) JOIN app.app_user u ON u.id=pm.user_id WHERE pm.organization_id=$1 AND pm.project_id=$2 AND pm.status='active' AND om.status='active' AND om.access_level='admin' AND u.status='active' AND u.login_name='admin'",
      [org, project],
    )
  ).rows;
  if (actors.length !== 1) throw new Error('Expected authorized project admin attribution');
  const actor = actors[0].id;
  const existing = (
    await db.query(
      'SELECT * FROM app.development_item WHERE organization_id=$1 AND project_id=$2',
      [org, project],
    )
  ).rows;
  let seq = Math.max(
    0,
    ...existing.map((r) => (/^DEV-\d+$/.test(r.code) ? Number(r.code.slice(4)) : 0)),
  );
  const result = [];
  for (const c of cases) {
    const marker = `案例导入：测试案例.txt / ${c.key}`;
    const found = existing.filter(
      (r) => (r.notes ?? '').includes(marker) || (r.name === c.name && r.module === c.module),
    );
    const input = fields({
      name: c.name,
      module: c.module,
      kind: 'report',
      priority: 'low',
      changeType: 'new',
      summaryFormat: 'html',
      summary: requirementHtml(c.summary),
    });
    if (found.length) {
      if (
        found.length !== 1 ||
        found[0].summary !== input.summary ||
        found[0].summary_format !== 'html' ||
        found[0].kind !== 'report' ||
        found[0].priority !== 'low' ||
        found[0].change_type !== 'new'
      )
        throw new Error('Existing case conflict: ' + c.key);
      result.push({ case: c.key, code: found[0].code, status: 'already-imported' });
      continue;
    }
    const id = randomUUID(),
      code = 'DEV-' + String(++seq).padStart(4, '0');
    if (apply) {
      await db.query(
        "INSERT INTO app.development_item(id,organization_id,project_id,code,name,module,kind,priority,change_type,summary,summary_format,notes,created_by) VALUES($1,$2,$3,$4,$5,$6,'report','low','new',$7,'html',$8,$9)",
        [
          id,
          org,
          project,
          code,
          c.name,
          c.module,
          input.summary,
          `${marker}\n原始分类：${c.originalKind}\n源文件 SHA-256：${sha}`,
          actor,
        ],
      );
      await db.query(
        'INSERT INTO app.fs_draft(item_id,organization_id,project_id,updated_by) VALUES($1,$2,$3,$4)',
        [id, org, project, actor],
      );
      await db.query(
        "INSERT INTO app.development_event(organization_id,project_id,item_id,actor_id,action,changes) VALUES($1,$2,$3,$4,'created',$5)",
        [
          org,
          project,
          id,
          actor,
          JSON.stringify({
            source: '测试案例.txt',
            case: c.key,
            sourceSha256: sha,
            operation: 'authorized-report-case-import',
          }),
        ],
      );
    }
    result.push({ case: c.key, code, status: apply ? 'imported' : 'planned' });
  }
  if (apply) {
    const saved = (
      await db.query(
        "SELECT * FROM app.development_item WHERE project_id=$1 AND notes LIKE '案例导入：测试案例.txt / %'",
        [project],
      )
    ).rows;
    if (saved.length !== 20) throw new Error('Imported count mismatch');
    for (const c of cases) {
      const row = saved.find((r) => r.module === c.module && r.name === c.name);
      if (
        !row ||
        row.summary !==
          fields({ summaryFormat: 'html', summary: requirementHtml(c.summary) }).summary ||
        row.business_owner_id ||
        row.developer_id ||
        row.tester_id ||
        row.planned_fs_date ||
        row.planned_dev_date ||
        row.planned_test_date
      )
        throw new Error('Content or blank-field verification failed: ' + c.key);
    }
  }
  await db.query(apply ? 'COMMIT' : 'ROLLBACK');
  await mkdir('artifacts', { recursive: true });
  await writeFile(
    'artifacts/report-case-import.json',
    JSON.stringify({ project: '虚拟测试项目', apply, sourceSha256: sha, result }, null, 2),
  );
  console.log(JSON.stringify({ project: '虚拟测试项目', apply, count: result.length, result }));
} catch (error) {
  await db.query('ROLLBACK');
  throw error;
} finally {
  await db.end();
}
