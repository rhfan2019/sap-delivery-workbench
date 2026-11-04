import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import pg from 'pg';
import { assertIsolatedDatabase } from '../testing/run-tests.mjs';
import { migrationNames, sourceHash } from './init-sql-source.mjs';
import { postgresTool } from './postgres-tools.mjs';

// Generates database/init/init-database.sql: the migrations and grants applied to an empty database
// on the isolated test server (npm run test:setup first), dumped as one script.
const root = fileURLToPath(new URL('../../', import.meta.url));
process.chdir(root);
const TEMPORARY_DATABASE = 'sap_fs_test_export_dev';
const isolated = parseEnv(await readFile('.runtime/fs-tests.env', 'utf8'));
assertIsolatedDatabase(isolated);
const env = { ...process.env };
for (const key of Object.keys(env))
  if (/^(POSTGRES_|APP_DB_|DATABASE_URL$|PG|NODE_ENV$)/.test(key)) delete env[key];
Object.assign(env, isolated, {
  POSTGRES_DB: TEMPORARY_DATABASE,
  PGPASSWORD: isolated.POSTGRES_PASSWORD,
  NODE_ENV: 'test',
});

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, env, encoding: 'utf8', maxBuffer: 2 ** 28 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr.slice(0, 500)}`);
  return result.stdout;
}

const header = `-- SAP 智能交付工作台：在一个空数据库上一次建好全部结构。
-- 生成的文件，不要手工修改：npm run test:setup，再 npm run db:export-init。
-- Source hash: ${sourceHash()}
--
-- 包含：应用 schema、表、索引、约束、函数、触发器、运行账号的权限和迁移记录，
-- 之后的 npm run db:migrate 只执行后续新增的迁移。
-- 不包含：业务数据、运行账号的密码和首个管理员。接着运行 scripts/database/provision.mjs
-- 与 scripts/database/bootstrap.mjs（服务器上用 infra/production/init-database.sh 一键完成）。
--
-- 用法：psql -v ON_ERROR_STOP=1 -U <数据库所有者> -d <空数据库> -f init-database.sql
-- 全程在一个事务内，失败不留痕；数据库不是空的就拒绝执行。

BEGIN;

DO $init$
BEGIN
  IF to_regnamespace('app') IS NOT NULL OR to_regclass('public.pgmigrations') IS NOT NULL THEN
    RAISE EXCEPTION '数据库不是空的（已有 app schema 或迁移记录），已停止，没有做任何修改。';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'sap_workbench_app') THEN
    CREATE ROLE sap_workbench_app NOLOGIN;
  END IF;
  EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO sap_workbench_app', current_database());
END
$init$;

`;

const admin = new pg.Client({
  host: isolated.POSTGRES_HOST,
  port: Number(isolated.POSTGRES_PORT),
  database: 'postgres',
  user: isolated.POSTGRES_USER,
  password: isolated.POSTGRES_PASSWORD,
});
await admin.connect();
const drop = () => admin.query(`DROP DATABASE IF EXISTS ${TEMPORARY_DATABASE}`);
try {
  await drop();
  await admin.query(`CREATE DATABASE ${TEMPORARY_DATABASE}`);
  run(process.execPath, ['scripts/database/migrate.mjs']);
  run(process.execPath, ['scripts/database/provision.mjs']);
  const dump = run(postgresTool('pg_dump'), [
    '-h',
    isolated.POSTGRES_HOST,
    '-p',
    isolated.POSTGRES_PORT,
    '-U',
    isolated.POSTGRES_USER,
    '-d',
    TEMPORARY_DATABASE,
    '--schema-only',
    '--no-owner',
  ]);
  const schema = dump
    .split('\n')
    // A random token each time, and only understood by the newest psql.
    .filter((line) => !/^\\(un)?restrict /.test(line) && !/^-- Dumped (from|by) /.test(line))
    .join('\n');
  const names = migrationNames();
  const history = names.map((name, index) => `  (${index + 1}, '${name}', now())`).join(',\n');
  const footer = `
-- Migration history: npm run db:migrate continues from here.
INSERT INTO public.pgmigrations (id, name, run_on) VALUES
${history};
SELECT pg_catalog.setval('public.pgmigrations_id_seq', ${names.length}, true);

COMMIT;
`;
  await writeFile('database/init/init-database.sql', header + schema.trim() + '\n' + footer);
  console.log(`Wrote database/init/init-database.sql from ${names.length} migrations.`);
} finally {
  await drop();
  await admin.end();
}
