import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  draftSkeleton,
  dropDanglingReferences,
  jobForPath,
  outlineProblems,
  partProblems,
  pickParts,
  salvageDocument,
  stampVersion,
} from '../../../../apps/api/src/modules/design-assistant/document.mjs';
import { validateFsdReport } from '@sap-delivery-workbench/contracts/design-assistant/fsd-report';

const isc001 = async () =>
  JSON.parse(
    await readFile(
      new URL('../../../fixtures/design-assistant/fsd-report/isc001.json', import.meta.url),
      'utf8',
    ),
  );

test('DOC-01 cover, target and evidence come from the task, aliased as the model saw them', () => {
  const doc = draftSkeleton(
    {
      cover: { doc_id: 'DEV-0024', title: '采购申请点检审批', project: '演示项目' },
      input: { text: '需求' },
      target: { product: 'S4_OP', release: 'S4CORE 105' },
    },
    [{ data: { name: 'EBAN' }, observed_at: '2026-10-10T00:00:00Z' }],
  );
  assert.deepEqual(
    [doc.doc.doc_id, doc.doc.title, doc.doc.project, doc.doc.version],
    ['DEV-0024', '采购申请点检审批', '演示项目', 'V1.0'],
  );
  assert.deepEqual(doc.target, { product: 'S4_OP', release: 'S4CORE 105', source: 'SYSTEM' });
  assert.equal(doc.working.evidence[0].id, 'EV-001');
  assert.equal(doc.working.evidence[0].object, 'EBAN');
  const noSap = draftSkeleton(
    { input: { text: '销售订单清单\n更多' }, target: { sap_disabled: true } },
    [],
  );
  assert.equal(noSap.target, undefined);
  assert.equal(noSap.doc.title, '销售订单清单');
});

test('DOC-02 a write answer keeps only the parts its job owns', async () => {
  const doc = await isc001();
  const spec = pickParts(doc, ['selection_screen', 'logic']);
  assert.deepEqual(Object.keys(spec).sort(), ['logic', 'selection_screen']);
  assert.deepEqual(spec.logic.sections, [], 'logic means the chapter intro, not its sections');
  const one = pickParts(doc, ['section:LOG-STOCK', 'open_issues']);
  assert.deepEqual(
    one.logic.sections.map((s) => s.id),
    ['LOG-STOCK'],
  );
  assert.equal(one.working.open_issues.length, 1);
});

test('DOC-03 a failing path is traced to the call that writes it', async () => {
  const doc = await isc001();
  assert.equal(jobForPath('/overview/difficulty', doc).key, 'require');
  assert.equal(jobForPath('/output/fields/3/handling', doc).key, 'spec');
  assert.deepEqual(jobForPath('/logic/sections/5/blocks/0', doc), {
    key: 'section:LOG-STOCK',
    parts: ['section:LOG-STOCK'],
    section: { id: 'LOG-STOCK', title: '库存信息获取' },
  });
  assert.equal(jobForPath('/messages/items/0/type', doc).key, 'tail');
  assert.equal(jobForPath('/doc/version', doc), null, 'the cover is the program’s');
});

test('DOC-04 dangling references are removed and listed as one open item', async () => {
  const doc = await isc001();
  doc.actions.items[0].logic = '见 [[LOG-MISSING]]';
  doc.working.open_issues[0].related.push('OUT-MISSING');
  const { doc: clean, removed } = dropDanglingReferences(doc);
  assert.deepEqual(removed.sort(), ['LOG-MISSING', 'OUT-MISSING']);
  assert.equal(clean.actions.items[0].logic, '见 ');
  const issue = clean.working.open_issues.find((i) => i.id === 'ISS-DANGLING-REFS');
  assert.equal(issue.blocking, false);
  assert.deepEqual(validateFsdReport(clean), { ok: true, errors: [] });
});

test('DOC-07 content the model got wrong is cut out and listed, the rest is kept', async () => {
  const doc = await isc001();
  const bad = doc.output.fields[2];
  bad.id = 'not an id';
  const sections = doc.logic.sections.length;
  const { doc: clean, removed, errors } = salvageDocument(doc);
  assert.deepEqual(errors, []);
  assert.equal(removed.length, 1);
  assert.equal(removed[0].path, '/output/fields/2/id');
  assert.ok(!clean.output.fields.some((f) => f.id === 'not an id'));
  assert.equal(clean.output.fields.length, doc.output.fields.length - 1);
  assert.equal(clean.logic.sections.length, sections);
  const issue = clean.working.open_issues.find((i) => i.id === 'ISS-QC-REMOVED');
  assert.equal(issue.blocking, false);
  assert.match(issue.impact, /\/output\/fields\/2\/id/);
  assert.deepEqual(validateFsdReport(clean), { ok: true, errors: [] });
});

test('DOC-08 a broken skeleton is not salvaged but reported', async () => {
  const doc = await isc001();
  doc.doc.version = 7;
  const { errors } = salvageDocument(doc);
  assert.ok(errors.some((e) => e.path === '/doc/version'));
});

test('DOC-05 outline and part checks name what is missing', () => {
  assert.deepEqual(outlineProblems({ outline: [] }), [
    { message: '提纲中没有业务逻辑章节（类型=逻辑）' },
  ]);
  assert.equal(
    outlineProblems({
      outline: [
        { id: 'LOG-A', type: '逻辑', title: 'A' },
        { id: 'msg-x', type: '消息' },
        { id: 'LOG-A', type: '逻辑', title: 'A' },
      ],
    }).length,
    2,
  );
  const check = partProblems({ key: 'section:LOG-A', section: { id: 'LOG-A', title: '查询' } });
  assert.equal(check({ doc: { logic: { sections: [] } } }).length, 1);
  assert.deepEqual(
    partProblems({ key: 'require', parts: ['overview', 'requirement'] })({
      doc: { overview: { summary: 'x' }, requirement: {} },
    }),
    [{ message: '缺少“## 业务需求”部分' }],
  );
});

test('DOC-06 artifact versions stamp the document version and change log', async () => {
  const doc = await isc001();
  const v2 = stampVersion(doc, 5, 'FSD');
  assert.equal(v2.doc.version, 'V1.4');
  assert.equal(v2.doc.change_log.at(-1).content, '编制正式 FSD');
  assert.equal(doc.doc.version, 'V1.3', 'the draft itself is not modified');
});
