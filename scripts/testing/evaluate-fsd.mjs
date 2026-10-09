import { readFile, writeFile, mkdir, cp, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { parseEnv } from 'node:util';
import { assertIsolatedDatabase } from './run-tests.mjs';
import pg from 'pg';
const args = process.argv.slice(2),
  value = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
const manifest = JSON.parse(
  await readFile('tests/fixtures/design-assistant/evaluation.json', 'utf8'),
);
const label = value('--label') ?? 'candidate';
if (!/^[a-z0-9_-]+$/i.test(label)) throw Error('Invalid label');
const started = new Date().toISOString(),
  id = randomUUID(),
  out = resolve('.runtime/artifacts/abap-backend-2026-10-08/evaluations', label + '-' + id);
await mkdir(out, { recursive: true });
const env = { ...process.env };
for (const key of Object.keys(env))
  if (/^(POSTGRES_|APP_DB_|DATABASE_URL$|PG|NODE_ENV$)/.test(key)) delete env[key];
Object.assign(env, parseEnv(await readFile('.runtime/fs-tests.env', 'utf8')), { NODE_ENV: 'test' });
assertIsolatedDatabase(env);
const hash = (b) => createHash('sha256').update(b).digest('hex');
const db = new pg.Client({
  host: env.POSTGRES_HOST,
  port: Number(env.POSTGRES_PORT),
  database: env.POSTGRES_DB,
  user: env.POSTGRES_USER,
  password: env.POSTGRES_PASSWORD,
});
await db.connect();
const files = [...new Set(manifest.cases.flatMap((c) => c.tests))],
  runs = {};
for (const file of files) {
  const browser = file.startsWith('tests/e2e/design-assistant/');
  if (browser) {
    try {
      const response = await fetch('http://127.0.0.1:16686/api/services', {
        signal: AbortSignal.timeout(3000),
      });
      if (!response.ok) throw Error('unavailable');
    } catch {
      runs[file] = { status: 'BLOCKED', reason: 'Local Jaeger unavailable', references: [] };
      continue;
    }
  }
  const utc = new Date().toISOString(),
    at = performance.now();
  const result = spawnSync(process.execPath, ['--test', '--test-timeout=60000', file], {
    env,
    encoding: 'utf8',
    timeout: 120000,
    windowsHide: true,
  });
  const evidence = file.split('/').at(-1) + '.log';
  await writeFile(out + '/' + evidence, (result.stdout ?? '') + (result.stderr ?? ''));
  if (browser && result.status === 0)
    await cp(
      resolve(
        '.runtime/artifacts/abap-backend-2026-10-08',
        file.endsWith('diagnosis.mjs') ? 'diagnosis' : 'browser',
      ),
      out + '/' + file.split('/').at(-1) + '.assets',
      { recursive: true },
    );
  const references = (
    await db.query(
      "SELECT r.id AS run_id,r.task_id,r.thread_id,r.input_snapshot_id,r.status,r.state->>'checkpoint_id' AS checkpoint_id,r.state->'budget' AS budget,(SELECT jsonb_agg(jsonb_build_object('attempt_id',a.id,'trace_id',a.trace_id,'generation',a.generation)) FROM app.fsd_v1_attempt a WHERE a.run_id=r.id) AS attempts,(SELECT count(*) FROM app.fsd_v1_commit c WHERE c.run_id=r.id) AS commit_count,(SELECT count(*) FROM app.fsd_v1_event e WHERE e.run_id=r.id) AS audit_count FROM app.fsd_v1_run r WHERE r.created_at >= $1 AND r.created_at <= clock_timestamp() ORDER BY r.created_at",
      [utc],
    )
  ).rows;
  runs[file] = {
    status: result.status === 0 ? 'PASS' : 'FAIL',
    duration_ms: Math.round(performance.now() - at),
    sha256: hash(await readFile(file)),
    evidence,
    references,
  };
}
await db.end();
const cases = manifest.cases.map((c) => ({
  case_id: c.case_id,
  status: c.blocker
    ? 'BLOCKED'
    : c.tests.some((f) => runs[f].status === 'FAIL')
      ? 'FAIL'
      : c.tests.some((f) => runs[f].status === 'BLOCKED')
        ? 'BLOCKED'
        : c.coverage === 'complete'
          ? 'PASS'
          : 'NOT_RUN',
  assertion_status: c.tests.length ? 'referenced tests executed' : 'no automated expert judgment',
  coverage: c.coverage,
  expected: c.assertions,
  actual:
    c.blocker ??
    (c.coverage === 'complete'
      ? 'all registered case assertions passed'
      : 'partial regression checks passed; complete design-case schedule/evidence not yet implemented'),
  tests: c.tests.map((file) => ({ file, ...runs[file] })),
  evidence_refs: c.tests.flatMap((file) => runs[file].references ?? []),
  expert_decision: null,
}));
for (const c of cases) {
  if (c.status === 'FAIL') c.actual = 'registered test execution failed; inspect archived log';
  if (c.status === 'BLOCKED' && !manifest.cases.find((spec) => spec.case_id === c.case_id).blocker)
    c.actual = 'required test infrastructure unavailable; assertions not completed';
}
const counts = Object.fromEntries(
  ['PASS', 'FAIL', 'BLOCKED', 'NOT_RUN'].map((s) => [
    s,
    cases.filter((c) => c.status === s).length,
  ]),
);
const git = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
const assets = {
  node: process.version,
  git_head: git,
  working_tree: 'uncommitted',
  lock_sha256: hash(await readFile('package-lock.json')),
  prompt_sha256: hash(await readFile('apps/api/src/modules/design-assistant/prompts/v1/system.md')),
  graph_sha256: hash(await readFile('apps/api/src/modules/design-assistant/graph.mjs')),
  fixture_sha256: hash(await readFile('tests/fixtures/design-assistant/evaluation.json')),
};
async function sourceFiles(directory) {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = directory + '/' + entry.name;
    if (entry.isDirectory()) paths.push(...(await sourceFiles(file)));
    else paths.push(file);
  }
  return paths;
}
const sources = [
  ...(await sourceFiles('apps/api/src/modules/design-assistant')),
  ...(await sourceFiles('packages/contracts/design-assistant')),
  ...(await sourceFiles('tests/fixtures/design-assistant')),
  ...files,
  'apps/api/src/modules/models/public.mjs',
  'apps/api/src/modules/sap/public.mjs',
  'apps/api/src/modules/item-workspace/public.mjs',
  'apps/api/src/modules/agent-runtime/public.mjs',
  'apps/web/src/features/item-workspace/FsdWorkbench.vue',
  'apps/web/src/features/item-workspace/ItemWorkspaceView.vue',
  'database/migrations/1791460000000_design-assistant-v1.sql',
  'infra/fsd-collector.yaml',
  'infra/fsd-observability.compose.yaml',
  'scripts/testing/evaluate-fsd.mjs',
];
const source_manifest = [];
for (const file of [...new Set(sources)].sort())
  source_manifest.push({ file, sha256: hash(await readFile(file)) });
assets.source_manifest_sha256 = hash(JSON.stringify(source_manifest));
await writeFile(out + '/source-manifest.json', JSON.stringify(source_manifest, null, 2) + '\n');
await writeFile(out + '/case-spec.json', JSON.stringify(manifest, null, 2) + '\n');
const evidence_matrix = [];
for (const c of manifest.cases) {
  const assertions = [];
  for (const file of c.tests) {
    const lines = (await readFile(file, 'utf8')).split('\n');
    for (let i = 0; i < lines.length; i++)
      if (
        lines[i].includes(c.case_id) ||
        {
          'OBS-02': /assert.*(?:trace_id|ABANDONED|LEASE_EXPIRED)|recovery\.reconciled/,
          'DBG-01': /before\.runs\[0\]\.error|failure-diagnostic|checkpoint: before/,
          'REC-03':
            /after_decision_commit_before_dispatch|task\.confirmations\[0\]\.id|dispatch_status/,
          'FLOW-03': /fixedQuestions|modelCalls|task\.budget\.model_calls/,
          'TOOL-08': /SAP-C01\.\.07/,
        }[c.case_id]?.test(lines[i])
      )
        assertions.push({ file, line: i + 1, text: lines[i].trim() });
  }
  const implementations = [];
  const names = c.case_id.startsWith('OBS')
    ? ['telemetry', 'repository']
    : c.case_id.startsWith('DBG')
      ? ['routes', 'worker']
      : c.case_id.startsWith('TOOL')
        ? ['sap', 'policy', 'probe']
        : c.case_id.startsWith('REC')
          ? ['worker', 'checkpointer', 'repository']
          : c.case_id.startsWith('STATE')
            ? ['repository']
            : ['graph', 'repository', 'policy', 'objects'];
  for (const name of names) {
    const file = 'apps/api/src/modules/design-assistant/' + name + '.mjs',
      lines = (await readFile(file, 'utf8')).split('\n');
    for (let i = 0; i < lines.length; i++)
      if (/^export (?:async )?function |^export class /.test(lines[i]))
        implementations.push({ file, line: i + 1, symbol: lines[i].trim() });
  }
  evidence_matrix.push({
    case_id: c.case_id,
    design: c.design,
    requirement_id: c.requirement_id,
    expected: c.assertions,
    implementation_symbols: implementations,
    test_assertions: assertions,
    commands: c.tests.map((f) => 'node --env-file=.runtime/fs-tests.env --test ' + f),
    result: cases.find((x) => x.case_id === c.case_id),
    reference_scope:
      'Database run references are grouped by serial test-file execution; assertion locations identify case-specific checks.',
  });
}
await writeFile(out + '/evidence-matrix.json', JSON.stringify(evidence_matrix, null, 2) + '\n');
const result = {
  experiment_id: id,
  label,
  dataset_id: manifest.dataset_id,
  dataset_version: manifest.version,
  data_mode: 'SYNTHETIC',
  started_at: started,
  ended_at: new Date().toISOString(),
  assets,
  counts,
  cases,
  quality: null,
  tokens: null,
  cost: null,
  measurement_limit:
    'Test-file wall time is harness duration, not model latency. Unknown business quality/token/cost are not zero.',
};
if (value('--baseline')) {
  const baseline = JSON.parse(await readFile(value('--baseline'), 'utf8'));
  const comparable = baseline.assets.fixture_sha256 === assets.fixture_sha256;
  result.comparison = {
    baseline_experiment_id: baseline.experiment_id,
    comparable,
    changed_assets: Object.keys(assets).filter((k) => assets[k] !== baseline.assets[k]),
    cases: cases.map((c) => ({
      case_id: c.case_id,
      before: baseline.cases.find((b) => b.case_id === c.case_id)?.status ?? 'NOT_RUN',
      after: c.status,
    })),
    quality_delta: null,
    tokens_delta: null,
    cost_delta: null,
  };
}
await writeFile(out + '/experiment.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ out, counts }, null, 2));
if (counts.FAIL) process.exitCode = 1;
