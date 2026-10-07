import { test } from 'node:test';
import assert from 'node:assert/strict';
import { queryTable, tableName, decodeResult } from '../apps/api/src/technical/sap-mcp.mjs';

const result = (value) => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
test('table names normalize but cannot inject paths, SQL or wildcards', () => {
  assert.equal(tableName(' t000 '), 'T000');
  assert.equal(tableName('/abc/table'), '/ABC/TABLE');
  for (const value of ['', 'T*', "T000' OR 1=1", '../T000', '/sap/bc/adt', {}, 'A'.repeat(31)])
    assert.throws(() => tableName(value), { code: 'INVALID_TABLE' });
});
test('tool errors and invalid JSON never become empty successes', async () => {
  await assert.rejects(decodeResult({ isError: true, content: [] }), { code: 'MCP_TOOL_ERROR' });
  await assert.rejects(decodeResult({ content: [{ type: 'text', text: 'broken' }] }), {
    code: 'MCP_RESULT_INVALID',
  });
});
test('paged MCP envelopes are reconstructed before parsing', async () => {
  const json = JSON.stringify(result({ status: 'success', result: { name: 't000' } }));
  const page = (offset, end) =>
    result({
      status: 'paged',
      resultId: 'r',
      offset,
      page: json.slice(offset, end),
      nextOffset: end === json.length ? null : end,
      totalCharacters: json.length,
    });
  const data = await decodeResult(page(0, 20), async (name, args) => {
    assert.equal(name, 'readResultPage');
    assert.equal(args.offset, 20);
    return page(20, json.length);
  });
  assert.equal(data.result.name, 't000');
});
test('broken paging does not silently truncate a result', async () => {
  await assert.rejects(
    decodeResult(
      result({
        status: 'paged',
        resultId: 'r',
        offset: 0,
        page: 'x',
        nextOffset: 0,
        totalCharacters: 2,
      }),
    ),
    { code: 'MCP_RESULT_INVALID' },
  );
});

function connection({ missing = false, empty = false, fail = false } = {}) {
  const calls = [];
  let closed = false;
  return {
    calls,
    get closed() {
      return closed;
    },
    serverInfo: { name: 'fixture', version: '1' },
    tools: (missing ? ['searchObject'] : ['searchObject', 'ddicElement', 'readResultPage']).map(
      (name) => ({ name, inputSchema: { type: 'object' } }),
    ),
    async call(name, args) {
      calls.push({ name, args });
      if (fail) return { isError: true, content: [] };
      if (name === 'searchObject')
        return result({
          status: 'success',
          results: empty
            ? []
            : [
                {
                  'adtcore:name': 'T000',
                  'adtcore:type': 'TABL/DT',
                  'adtcore:uri': '/sap/bc/adt/ddic/tables/t000',
                },
              ],
        });
      return result({
        status: 'success',
        result: {
          name: 't000',
          type: 'TABL/DT',
          children: [
            {
              name: 'mandt',
              properties: {
                elementProps: { ddicIsKey: true, ddicDataType: 'clnt', ddicLength: 3 },
              },
            },
          ],
        },
      });
    },
    async close() {
      closed = true;
    },
  };
}
test('query discovers tools and reads exact table metadata without table data or SQL', async () => {
  const c = connection();
  const data = await queryTable('t000', { connect: async () => c });
  assert.equal(data.tableName, 'T000');
  assert.equal(data.fieldCount, 1);
  assert.equal(data.definition.children[0].properties.elementProps.ddicIsKey, true);
  assert.deepEqual(
    c.calls.map((c) => c.name),
    ['searchObject', 'ddicElement'],
  );
  assert.deepEqual(c.calls[1].args, { path: 'T000' });
  assert.ok(c.closed);
});
for (const [options, code] of [
  [{ missing: true }, 'MCP_TOOL_MISSING'],
  [{ empty: true }, 'TABLE_NOT_FOUND'],
  [{ fail: true }, 'MCP_TOOL_ERROR'],
])
  test(`query ${code} closes its isolated MCP session`, async () => {
    const c = connection(options);
    await assert.rejects(queryTable('T000', { connect: async () => c }), { code });
    assert.ok(c.closed);
  });
