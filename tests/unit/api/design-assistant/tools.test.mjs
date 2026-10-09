import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collectPages,
  normalizeToolResult,
} from '../../../../apps/api/src/modules/design-assistant/sap.mjs';
import {
  validateTool,
  validateEvidence,
} from '../../../../apps/api/src/modules/design-assistant/policy.mjs';
const envelope = (value) => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
test('TOOL-03 missing metadata and truncated source remain partial with exact property gaps', () => {
  const target = { target_ref: 't', client: '000' },
    item = { tool_name: 'ddicElement', required_properties: ['type', 'length', 'unit'] };
  const e = normalizeToolResult(
    { status: 'success', source_version: 'v1', result: { type: 'QUAN' } },
    item,
    target,
    'g1',
  );
  assert.equal(e.status, 'PARTIAL');
  assert.deepEqual(e.missing_properties, ['length', 'unit']);
  assert.equal(e.coverage.complete, false);
  assert.equal(validateEvidence(e, target, item.required_properties).valid, false);
  const source = normalizeToolResult(
    { status: 'success', source_version: 'v1', hasMore: true, result: { source: 'partial' } },
    { tool_name: 'getObjectSource', required_properties: ['source'] },
    target,
    'g2',
  );
  assert.equal(source.status, 'PARTIAL');
  assert.equal(source.coverage.truncated, true);
  assert.equal(validateEvidence(source, target, ['source']).valid, false);
});
test('TOOL-04 pagination hook brackets each physical page for durable settlement', async () => {
  const body = JSON.stringify({ status: 'success', result: { field: 'ZPOC' } }),
    events = [];
  const first = envelope({
    status: 'paged',
    resultId: 'pages',
    totalCharacters: body.length,
    offset: 0,
    page: body.slice(0, 8),
    nextOffset: 8,
  });
  const result = await collectPages(
    first,
    async () => {
      events.push('remote');
      return envelope({ resultId: 'pages', offset: 8, page: body.slice(8), nextOffset: null });
    },
    {
      readGeneration: 'generation-1',
      onPage: async (page, read) => {
        assert.equal(page.offset, 8);
        assert.equal(page.read_generation, 'generation-1');
        events.push('reserve');
        const value = await read();
        events.push('settle');
        return value;
      },
    },
  );
  assert.equal(result.result.field, 'ZPOC');
  assert.deepEqual(events, ['reserve', 'remote', 'settle']);
});
test('TOOL-02/07 generic upstream errors remain UNKNOWN_CAUSE, not invented authorization facts', async () => {
  await assert.rejects(
    () =>
      collectPages({
        isError: true,
        content: [{ type: 'text', text: 'not found forbidden password SECRET' }],
      }),
    (e) =>
      e.code === 'UNKNOWN_CAUSE' &&
      e.error_origin === 'SAP_REMOTE' &&
      !e.message.includes('SECRET'),
  );
});
test('TOOL-02 paged remote denial retains its non-retryable error classification', async () => {
  const body = JSON.stringify(envelope({ status: 'error', error: { code: 'AUTH_DENIED' } }));
  await assert.rejects(
    () =>
      collectPages(
        envelope({
          status: 'paged',
          resultId: 'r',
          totalCharacters: body.length,
          offset: 0,
          page: body,
          nextOffset: null,
        }),
        async () => assert.fail('no continuation expected'),
      ),
    { code: 'AUTH_DENIED' },
  );
});
test('TOOL-04 ordered pagination uses actual cursor; skipped/foreign pages cannot be joined', async () => {
  const data = JSON.stringify({ status: 'success', result: { value: 'test' } }),
    cut = 10;
  const first = envelope({
    status: 'paged',
    resultId: 'r',
    totalCharacters: data.length,
    offset: 0,
    page: data.slice(0, cut),
    nextOffset: cut,
  });
  const seen = [];
  const result = await collectPages(first, async (name, args) => {
    seen.push({ name, args });
    return envelope({ resultId: 'r', offset: cut, page: data.slice(cut), nextOffset: null });
  });
  assert.equal(result.result.value, 'test');
  assert.deepEqual(seen, [{ name: 'readResultPage', args: { resultId: 'r', offset: cut } }]);
  for (const override of [{ resultId: 'other' }, { offset: cut + 1 }, { read_generation: 'other' }])
    await assert.rejects(
      () =>
        collectPages(
          first,
          async () =>
            envelope({
              resultId: 'r',
              offset: cut,
              page: data.slice(cut),
              nextOffset: null,
              ...override,
            }),
          { readGeneration: 'g' },
        ),
      (e) =>
        e.code === 'RESULT_EXPIRED' &&
        e.read_progress.received_characters === cut &&
        e.read_progress.expected_characters === data.length,
    );
});
test('TOOL-05/06 old evidence is not revived by a matching hash', () => {
  const e = {
    target_ref: 't',
    client: '000',
    source_version: '1',
    observed_at: '2000-01-01',
    coverage: { complete: true, properties: ['type'] },
    validity: 'VALID',
  };
  assert.ok(
    validateEvidence(e, { target_ref: 't', client: '000' }, ['type']).reasons.includes(
      'STALE_EVIDENCE',
    ),
  );
});
test('TOOL-01 URL and argument validation deny unknown fields before transport', () => {
  const item = {
    target_ref: 't',
    tool_name: 'searchObject',
    arguments: { query: 'ZPOC', sqlQuery: 'DELETE FROM x' },
  };
  assert.throws(() => validateTool(item, { target_ref: 't' }), /INVALID_TOOL_INPUT/);
  assert.throws(
    () => validateTool({ ...item, arguments: { query: '*' } }, { target_ref: 't' }),
    /INVALID_TOOL_INPUT/,
  );
});
test('TOOL-03b ddicElement by approved table name keeps requested fields and keys', () => {
  const target = {
    target_ref: 't',
    client: '100',
    allowed_urls: ['/sap/bc/adt/ddic/tables/vbap'],
  };
  const item = {
    target_ref: 't',
    tool_name: 'ddicElement',
    arguments: { path: 'VBAP' },
    required_properties: ['KWMENG', 'ABGRU'],
  };
  validateTool(item, target);
  assert.throws(() => validateTool({ ...item, arguments: { path: 'LIKP' } }, target));
  const field = (name, key = false) => ({
    type: 'TABL/DTF',
    name,
    properties: { elementProps: { ddicIsKey: key, ddicDataElement: name, ddicLength: 10 } },
  });
  const e = normalizeToolResult(
    {
      status: 'success',
      source_version: { changed_at: 1, version: 'active' },
      result: {
        type: 'TABL/DT',
        name: 'vbap',
        children: [field('vbeln', true), field('posnr', true), field('kwmeng'), field('matnr')],
      },
    },
    item,
    target,
    'g',
  );
  assert.deepEqual(
    e.data.fields.map((f) => f.name),
    ['VBELN', 'POSNR', 'KWMENG'],
  );
  assert.equal(e.data.field_count, 4);
  assert.deepEqual(e.missing_properties, ['ABGRU']);
  assert.equal(e.status, 'PARTIAL');
});
