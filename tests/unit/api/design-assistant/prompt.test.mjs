import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { structuredPrompt } from '../../../../apps/api/src/modules/design-assistant/model.mjs';
import { assetManifest } from '../../../../apps/api/src/modules/design-assistant/assets.mjs';

const document = async () =>
  JSON.parse(
    await readFile(
      new URL('../../../fixtures/design-assistant/fsd-report/isc001.json', import.meta.url),
      'utf8',
    ),
  );
const run = (snapshot = {}) => ({
  assets: { prompt_text: 'SYSTEM-PROMPT' },
  snapshot: { text: '需求', answers: {}, base_evidence: [], ...snapshot },
  state: {},
  input_snapshot_id: 'snap',
});
const noSap = { target_ref: 'no-sap', sap_disabled: true };

test('PROMPT-01 the current document enters a prompt once, not again as the snapshot copy', async () => {
  const doc = await document();
  doc.requirement.background = 'MARKER-DOCUMENT-CONTENT';
  for (const kind of ['FsdRevise', 'ReviewResult']) {
    const { prompt } = structuredPrompt({
      kind,
      r: run({ base_document: structuredClone(doc) }),
      t: { evidence: [], document: doc, target: noSap },
      part: kind === 'FsdRevise' ? { key: 'revise:input', reason: 'input' } : null,
    });
    assert.equal(prompt.split('MARKER-DOCUMENT-CONTENT').length - 1, 1, kind);
    assert.ok(prompt.includes('## 业务需求'), kind + ': the document is given in the wire format');
  }
});

test('PROMPT-02 a section write names exactly the section and gives the outline', () => {
  const { prompt, wire } = structuredPrompt({
    kind: 'FsdWrite',
    r: run(),
    t: { evidence: [], document: null, target: noSap },
    part: {
      key: 'section:LOG-APPROVE',
      parts: ['section:LOG-APPROVE'],
      section: { id: 'LOG-APPROVE', title: '采购申请审批' },
      outline: [{ id: 'LOG-APPROVE', type: '逻辑', title: '采购申请审批', summary: '多级审批' }],
    },
  });
  assert.equal(wire, true);
  assert.ok(prompt.startsWith('SYSTEM-PROMPT'));
  assert.ok(prompt.includes('“## 逻辑 LOG-APPROVE 采购申请审批”'));
  assert.ok(prompt.includes('LOG-APPROVE｜逻辑｜采购申请审批｜多级审批'));
  assert.ok(prompt.includes('本次未接入 SAP'));
});

test('PROMPT-03 removed runtime hints stay removed (H6 answer count, H14 brevity cap)', () => {
  const answers = Object.fromEntries(
    Array.from({ length: 8 }, (_, i) => ['q' + i, { question_id: 'q' + i }]),
  );
  for (const kind of ['AnalysisResult', 'ClarificationBatch', 'FsdOutline']) {
    const { prompt } = structuredPrompt({
      kind,
      r: run({ answers }),
      t: { evidence: [], document: null, target: noSap },
      part: kind === 'FsdOutline' ? { key: 'outline' } : null,
    });
    assert.doesNotMatch(prompt, /应直接 PROPOSE|不超过两句|3000 字/, kind);
  }
});

test('PROMPT-04 structured calls and free chat use the same prompt V2 file', async () => {
  const assets = await assetManifest();
  assert.equal(assets.prompt_text, assets.chat_prompt_text);
  for (const heading of [
    '## 一、你是谁',
    '## 三、你怎么思考',
    '## 四、依据纪律',
    '## 五、什么时候提问、怎么出题',
    '## 六、FSD 怎么写',
    '## 十、输出格式',
    '## 十一、普通对话',
  ])
    assert.ok(assets.prompt_text.includes(heading), heading);
});
