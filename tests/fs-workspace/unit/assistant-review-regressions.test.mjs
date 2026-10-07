import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { executor } from '../../../apps/api/src/abap-fsd-agent/executor.mjs';
import { planRun } from '../../../apps/api/src/abap-fsd-agent/coordinator.mjs';
import { renderMarkdown } from '../../../apps/api/src/abap-fsd-agent/specification.mjs';
const example = () =>
  JSON.parse(
    readFileSync(
      new URL('../../../packages/contracts/abap-fsd-agent/fsd/v1/r.example.json', import.meta.url),
      'utf8',
    ),
  );
async function failedDraft(output) {
  const snapshots = [];
  let calls = 0,
    saves = 0;
  const work = executor({
    action: 'draft',
    plan: planRun({ request: '报表', action: 'draft' }),
    context: {
      messages: [{ role: 'system', content: 'test-only' }],
      manifest: { sources: example().sources },
    },
    profile: { systemId: null, identificationSource: 'unknown', profile: {}, evidence: [] },
    verify: { systemId: null },
    persist: async (id, snapshot) => snapshots.push(structuredClone(snapshot)),
    save: async () => {
      saves++;
    },
  });
  let error;
  try {
    await work({
      run: { id: 'local-review' },
      signal: new AbortController().signal,
      emit: () => {},
      invoke: async (options) => {
        calls++;
        options.onDelta(output);
        return { modelId: 'local-double' };
      },
    });
  } catch (e) {
    error = e;
  }
  return { error, snapshots, calls, saves };
}
test('invalid JSON after one repair remains OUTPUT_PROTOCOL in final durable failure', async () => {
  const result = await failedDraft('这是一个没有JSON协议的自然语言回复');
  assert.equal(result.calls, 2);
  assert.equal(result.saves, 0);
  assert.equal(result.error.code, 'OUTPUT_PROTOCOL');
  assert.equal(result.snapshots.at(-1).failure.code, 'OUTPUT_PROTOCOL');
});
test('valid JSON with invalid structure remains STRUCTURE_VALIDATION after one repair', async () => {
  const result = await failedDraft('{"riceType":"R"}');
  assert.equal(result.calls, 2);
  assert.equal(result.saves, 0);
  assert.equal(result.error.code, 'STRUCTURE_VALIDATION');
  assert.equal(result.snapshots.at(-1).failure.code, 'STRUCTURE_VALIDATION');
});
test('consultant free text matching protocol enums remains a literal business fact', () => {
  const spec = example();
  spec.rules[0].decision.value = 'open';
  spec.fields[0].defaultRule.value = 'high';
  const main = renderMarkdown(spec).split('## 附录')[0];
  assert.match(main, /建议：open/);
  assert.match(main, /建议：high/);
});
test('real metadata statuses use object assurance wording in the main document', () => {
  const wants = { unreadable: '无法读取', conflicting: '核验冲突', partial: '部分核验' };
  for (const [status, word] of Object.entries(wants)) {
    const spec = example();
    spec.sapObjects[0].verificationStatus = status;
    const main = renderMarkdown(spec).split('## 附录')[0];
    assert.ok(main.includes(`（${word}）`), status);
    assert.doesNotMatch(main, /unreadable|conflicting/);
  }
});
import { streamText } from '../../../apps/api/src/abap-fsd-agent/model-stream.mjs';
import { classifyFailure } from '../../../apps/api/src/abap-fsd-agent/errors.mjs';

test('malformed SSE content is OUTPUT_PROTOCOL rather than a model connection interruption', async () => {
  let error;
  try {
    await streamText(
      {
        protocol: 'openai_chat',
        provider: 'synthetic',
        modelId: 'test',
        maxOutputTokens: 1000,
        temperature: null,
      },
      'synthetic',
      'local-only',
      {
        onDelta: () => {},
        transport: async function* () {
          yield Buffer.from('data: not-json\n\n');
        },
      },
    );
  } catch (e) {
    error = e;
  }
  assert.ok(error);
  assert.equal(classifyFailure(error, 'generate').code, 'OUTPUT_PROTOCOL');
});
