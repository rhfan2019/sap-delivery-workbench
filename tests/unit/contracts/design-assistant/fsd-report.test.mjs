import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  FSD_REPORT_VERSION,
  validateFsdReport,
  checkReferences,
  collectSapRefs,
} from '@sap-delivery-workbench/contracts/design-assistant/fsd-report';

const isc001 = async () =>
  JSON.parse(
    await readFile(
      new URL('../../../fixtures/design-assistant/fsd-report/isc001.json', import.meta.url),
      'utf8',
    ),
  );

test('FSDR-01 standard sample ISC001 is a valid fsd-report/1 document', async () => {
  const doc = await isc001();
  assert.equal(doc.schema_version, FSD_REPORT_VERSION);
  assert.deepEqual(validateFsdReport(doc), { ok: true, errors: [] });
});

test('FSDR-02 every [[ID]] in the sample resolves, including reserved sections', async () => {
  const doc = await isc001();
  const refs = checkReferences(doc);
  assert.equal(refs.ok, true);
  assert.ok(JSON.stringify(doc).includes('[[SEC-MESSAGES]]'));
});

test('FSDR-03 dangling reference is reported with its location', async () => {
  const doc = await isc001();
  doc.actions.items[0].logic = '见 [[LOG-NOT-DEFINED]]';
  const result = validateFsdReport(doc);
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, [
    {
      path: '/actions/items/0/logic',
      keyword: 'dangling',
      message: 'unknown reference LOG-NOT-DEFINED',
    },
  ]);
});

test('FSDR-04 duplicate object id and redefined reserved id are rejected', async () => {
  const doc = await isc001();
  doc.selection_screen.fields[1].id = 'SEL-WERKS';
  doc.selection_checks.items[0].id = 'SEC-AUTH';
  const keywords = validateFsdReport(doc)
    .errors.map((e) => e.keyword)
    .sort();
  assert.deepEqual(keywords, ['duplicate', 'reserved']);
});

test('FSDR-05 schema rejects unknown fields, bad ids and Public Cloud targets', async () => {
  for (const mutate of [
    (d) => (d.output.fields[0].parameters = []),
    (d) => (d.selection_screen.fields[0].id = 'werks'),
    (d) => (d.target.product = 'S4_PUBLIC_CLOUD'),
  ]) {
    const doc = await isc001();
    mutate(doc);
    const result = validateFsdReport(doc);
    assert.equal(result.ok, false);
    assert.ok(
      result.errors.every((e) => !['dangling', 'duplicate', 'reserved'].includes(e.keyword)),
    );
  }
});

test('FSDR-06 SAP objects are collected once per object with their sections', async () => {
  const refs = collectSapRefs(await isc001());
  const names = refs.map((r) => r.name);
  assert.equal(new Set(names).size, names.length);
  assert.deepEqual(
    refs.find((r) => r.name === 'EBAN'),
    {
      type: 'TABLE',
      name: 'EBAN',
      sections: ['LOG-QUERY'],
    },
  );
  assert.ok(names.includes('MD_STOCK_REQUIREMENTS_LIST_API'));
});
