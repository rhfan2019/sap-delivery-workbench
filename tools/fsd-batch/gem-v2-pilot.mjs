// Same HTTP executor as the frontend. One attempt per item, durable IDs, no model retry.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
const code = process.argv[2] ?? 'DEV-0007';
const sourceIds = {
  'DEV-0007': '11aa9b91-1a69-4657-944d-3f43fdf793cd',
  'DEV-0002': '4cb2d832-91df-4585-97bb-cad64507f559',
};
if (!sourceIds[code]) throw new Error('Supported acceptance codes: DEV-0007, DEV-0002');
const config = JSON.parse(
  readFileSync(new URL('./configs/acceptance.json', import.meta.url), 'utf8'),
);
const root = new URL('./runs/gem-v2-pilot/', import.meta.url);
mkdirSync(root, { recursive: true });
const checkpoint = new URL(code + '.json', root);
const cookie = readFileSync(
  process.env.FSD_COOKIE_FILE || new URL('./runs/acceptance.cookie', import.meta.url),
  'utf8',
).trim();
const base = config.url + '/api/projects/' + config.projectId + '/development-items/';
async function request(url, body) {
  const r = await fetch(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { cookie, origin: config.url, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(r.status + ': ' + data.message);
  return data;
}
if (code === 'DEV-0002') {
  const previous = new URL('DEV-0007.json', root);
  if (!existsSync(previous) || JSON.parse(readFileSync(previous)).result?.state !== 'completed')
    throw new Error('DEV-0007 must complete before DEV-0002');
}
const date = new Date();
const p = (n) => String(n).padStart(2, '0');
const prefix =
  String(date.getFullYear()).slice(-2) +
  p(date.getMonth() + 1) +
  p(date.getDate()) +
  '-' +
  p(date.getHours()) +
  p(date.getMinutes()) +
  p(date.getSeconds()) +
  '-';
let state = existsSync(checkpoint)
  ? JSON.parse(readFileSync(checkpoint, 'utf8'))
  : {
      code,
      sourceId: sourceIds[code],
      prefix,
      cloneRequestId: randomUUID(),
      requestId: randomUUID(),
      createdAt: new Date().toISOString(),
    };
const save = () => writeFileSync(checkpoint, JSON.stringify(state, null, 2));
save();
if (!state.copy) {
  state.copy = await request(base + state.sourceId + '/test-copy', {
    prefix: state.prefix,
    requestId: state.cloneRequestId,
  });
  save();
}
const url = base + state.copy.id + '/work/design/gem-fsd-v2/runs';
if (!state.result) {
  state.result = await request(url, {
    requestId: state.requestId,
    prompt: '生成完整FSD。以下补充均为自动化测试预置假设，不是生产业务审批。',
    answers: [...new Set(config.answers[code].map((a) => a.text))].join('\n'),
  });
  save();
}
const started = Date.parse(state.result.createdAt);
let lastPrint = 0;
while (state.result.state === 'running') {
  if (Date.now() - started > 365000) {
    state.result = await request(url + '/' + state.requestId + '/cancel', {});
    save();
    break;
  }
  await delay(2000);
  state.result = await request(url + '/' + state.requestId);
  save();
  if (Date.now() - lastPrint > 30000) {
    console.log(
      JSON.stringify({
        code,
        state: state.result.state,
        elapsedSeconds: Math.round((Date.now() - started) / 1000),
        progress: state.result.snapshot.progress,
      }),
    );
    lastPrint = Date.now();
  }
}
state.trace = await request(url + '/' + state.requestId + '/trace');
save();
if (state.result.markdown) writeFileSync(new URL(code + '.md', root), state.result.markdown);
console.log(
  JSON.stringify({
    code,
    copyId: state.copy.id,
    runId: state.requestId,
    state: state.result.state,
    elapsedMs: state.result.snapshot.elapsedMs,
    failure: state.result.snapshot.failure,
    characters: state.result.markdown?.length,
  }),
);
if (state.result.state !== 'completed') process.exitCode = 2;
