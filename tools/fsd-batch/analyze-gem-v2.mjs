import { readFileSync, writeFileSync } from 'node:fs';
const code = process.argv[2] ?? 'DEV-0007';
if (!/^DEV-\d{4}$/.test(code)) throw new Error('Invalid code');
const root = new URL('./runs/gem-v2-pilot/', import.meta.url);
const state = JSON.parse(readFileSync(new URL(code + '.json', root), 'utf8'));
const events = state.trace.events,
  find = (type) => events.find((e) => e.type === type),
  last = (type) => events.findLast((e) => e.type === type);
const begin = find('model.started'),
  first = find('model.delta'),
  end = last('generation.failed') ?? last('model.completed'),
  terminal = events.at(-1);
const ms = (a, b) => (a && b ? Date.parse(b.at) - Date.parse(a.at) : null);
const total = ms(find('run.started'), terminal);
const phases = [
  ['首段正文前等待（含连接及推理）', ms(begin, first)],
  ['正文输出至结束/中止', ms(first, end)],
  ['其余编排与终态处理', total - ms(begin, end)],
];
const result = {
  code,
  runId: state.requestId,
  state: state.result.state,
  totalMs: total,
  phases: phases.map(([name, durationMs]) => ({
    name,
    durationMs,
    percent: total ? (durationMs / total) * 100 : null,
  })),
  modelCalls: events.filter((e) => e.type === 'model.started').length,
  providerCalls: events.filter((e) => e.type === 'provider.started').length,
  documentSaved: !!state.result.markdown,
  structurePassed: events.some((e) => e.type === 'validation.completed' && e.data.valid),
  structureValidation: events.some((e) => e.type === 'validation.completed')
    ? events.some((e) => e.type === 'validation.completed' && e.data.valid)
      ? 'passed'
      : 'failed'
    : 'not_executed',
  businessQuality: '未评审',
  failure: state.result.snapshot.failure,
  model: state.result.snapshot.model,
  progress: state.result.snapshot.progress,
};
writeFileSync(new URL(code + '-analysis.json', root), JSON.stringify(result, null, 2));
if (end?.data.output && !state.result.markdown)
  writeFileSync(
    new URL(code + '-partial.md', root),
    '# 未完成候选：不可作为完整说明书\n\n' + end.data.output,
  );
const table =
  '| 步骤 | 耗时（秒） | 占比 |\n|---|---:|---:|\n' +
  result.phases
    .map((p) => `| ${p.name} | ${(p.durationMs / 1000).toFixed(3)} | ${p.percent.toFixed(2)}% |`)
    .join('\n');
writeFileSync(
  new URL(code + '-timing.md', root),
  table + '\n\n占比基于服务端运行日志，首段正文前等待不能完全等同于模型推理时间。\n',
);
console.log(JSON.stringify(result, null, 2));
