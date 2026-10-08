import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { extractBytes } from '../../../../apps/api/src/modules/agent-runtime/attachment-parser.mjs';
import { validateDraft } from '../../../../apps/api/src/modules/agent-runtime/specification.mjs';
import { readFileSync } from 'node:fs';
import { createRunStore } from '../../../../apps/api/src/modules/agent-runtime/runs.mjs';
test('XLSX preserves shared and inline strings with xml:space attributes', async () => {
  const z = new JSZip();
  for (const [p, t] of Object.entries({
    'xl/workbook.xml': '<workbook><sheets><sheet name="S" r:id="r1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':
      '<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/sharedStrings.xml': '<sst><si><t xml:space="preserve"> UNIQUE-X </t></si></sst>',
    'xl/worksheets/sheet1.xml':
      '<worksheet><sheetData><row><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t xml:space="preserve"> INLINE-Y </t></is></c></row></sheetData></worksheet>',
  }))
    z.file(p, t);
  const r = await extractBytes('x.xlsx', await z.generateAsync({ type: 'nodebuffer' }));
  assert.match(r.regions[0].text, /UNIQUE-X/);
  assert.match(r.regions[1].text, /INLINE-Y/);
});
test('registered source boundary rejects fabricated attachment references', () => {
  const s = JSON.parse(readFileSync('packages/contracts/agent-runtime/fsd/v1/r.example.json'));
  s.sources[0].kind = 'processed_attachment';
  s.sources[0].reference = 'attachment:missing:page:999';
  assert.equal(validateDraft(s, { sources: [] }).valid, false);
});
test('save commit boundary wins late cancellation and emits saved artifact', async () => {
  let entered, release;
  const started = new Promise((r) => (entered = r)),
    gate = new Promise((r) => (release = r));
  const store = createRunStore();
  const run = store.start({
    owner: { userId: 'u', sessionId: 's' },
    model: { id: 'm', config: { modelId: 'x', timeoutSeconds: 10 } },
    execute: async ({ run, emit }) => {
      run.commitStarted = true;
      entered();
      await gate;
      emit('artifact.ready', { id: 'saved' });
      return {};
    },
  });
  await started;
  store.cancel(run);
  release();
  await run.task;
  assert.equal(run.status, 'completed');
  assert.ok(run.events.some((e) => e.type === 'artifact.ready'));
  store.close();
});
