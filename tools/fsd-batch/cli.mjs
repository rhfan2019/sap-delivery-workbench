import { resolve, join } from 'node:path';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createClient } from './lib/client.mjs';
import { executeBatch } from './lib/runner.mjs';
import { writeReport } from './lib/report.mjs';
import { readJson } from './lib/storage.mjs';
const home = fileURLToPath(new URL('./', import.meta.url));
const [command, ...args] = process.argv.slice(2);
const flags = {};
for (let i = 0; i < args.length; i++) {
  if (!args[i].startsWith('--')) throw Error('参数必须使用 --name value');
  const key = args[i].slice(2);
  flags[key] = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true;
}
if (!['run', 'resume', 'analyze'].includes(command)) {
  console.log(
    'node tools/fsd-batch/cli.mjs run --config <json> --out <dir>\nnode tools/fsd-batch/cli.mjs resume --out <dir> [--config <updated-answers.json>] [--retry-failed]\nnode tools/fsd-batch/cli.mjs analyze --out <dir>\n认证: FSD_BATCH_COOKIE_FILE 文件包含 cookie 字符串；或 FSD_BATCH_LOGIN / FSD_BATCH_PASSWORD。',
  );
  process.exit(command ? 1 : 0);
}
if (!flags.out) throw Error('必须指定 --out 批次目录');
const dir = resolve(flags.out);
if (command === 'analyze') {
  console.log(JSON.stringify(writeReport(dir).summary));
  process.exit(0);
}
const config = readJson(flags.config ? resolve(flags.config) : join(dir, 'config.json'));
if (
  !Array.isArray(config.codes) ||
  !config.codes.length ||
  config.codes.some((c) => !/^DEV-\d+$/.test(c)) ||
  new Set(config.codes).size !== config.codes.length
)
  throw Error('codes 必须是无重复的 DEV 编号列表');
if (!/^[a-f0-9-]{36}$/i.test(config.projectId)) throw Error('projectId 无效');
const url = config.url ?? 'http://127.0.0.1:5173',
  origin = config.origin ?? url;
let cookie = process.env.FSD_BATCH_COOKIE_FILE
  ? readFileSync(process.env.FSD_BATCH_COOKIE_FILE, 'utf8').trim()
  : null;
if (!cookie) {
  const r = await fetch(url + '/api/login', {
    method: 'POST',
    headers: { origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      loginName: process.env.FSD_BATCH_LOGIN,
      password: process.env.FSD_BATCH_PASSWORD,
    }),
  });
  if (!r.ok) throw Error(`登录失败 ${r.status}；请配置认证环境变量`);
  cookie = r.headers.get('set-cookie')?.split(';')[0];
}
const client = createClient({ url, origin, cookie });
await client.request('/api/session');
const controller = new AbortController();
process.on('SIGINT', () => controller.abort());
process.on('SIGTERM', () => controller.abort());
try {
  const s = await executeBatch({
    client,
    config,
    dir,
    retryFailed: !!flags['retry-failed'],
    signal: controller.signal,
  });
  writeReport(dir);
  process.exitCode = s.status === 'completed' ? 0 : 2;
} catch (e) {
  if (existsSync(join(dir, 'state.json'))) writeReport(dir);
  console.error(e.message);
  process.exitCode = 1;
}
