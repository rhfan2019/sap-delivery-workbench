import test from 'node:test';
import assert from 'node:assert/strict';
import {
  guardSapCall,
  openSap,
  truncate,
  formatResult,
  SAP_TOOLS,
} from '../../../../apps/api/src/modules/agent-core/sap-tools.mjs';

test('only whitelisted read tools pass; SQL must be a single SELECT; limits are clamped', () => {
  assert.match(guardSapCall('setObjectSource', {}), /白名单/);
  assert.match(guardSapCall('runClass', {}), /白名单/);
  assert.match(guardSapCall('runQuery', { sqlQuery: 'DELETE FROM TVAK' }), /SELECT/);
  assert.match(
    guardSapCall('runQuery', { sqlQuery: 'SELECT * FROM TVAK; DROP TABLE X' }),
    /SELECT/,
  );
  const args = { sqlQuery: 'SELECT AUART, VBTYP FROM TVAK', rowNumber: 5000 };
  assert.equal(guardSapCall('runQuery', args), null);
  assert.equal(args.rowNumber, 100);
  const source = { objectSourceUrl: 'x', maxLines: 99999 };
  assert.equal(guardSapCall('getObjectSource', source), null);
  assert.equal(source.maxLines, 400);
  assert.match(truncate('x'.repeat(30000)), /已截断/);
  assert.match(
    guardSapCall('tableContents', { ddicEntityName: 'T000', sqlQuery: 'DELETE FROM T000' }),
    /SELECT/,
  );
  assert.equal(guardSapCall('tableContents', { ddicEntityName: 'T000' }), null);
});

test('table definitions are reduced to one line per field', () => {
  const field = (name, key, type, length) => ({
    type: 'TABL/DTF',
    name,
    properties: {
      elementProps: {
        ddicIsKey: key,
        ddicDataElement: name,
        ddicDataType: type,
        ddicLength: length,
      },
    },
  });
  const text = formatResult('ddicElement', {
    status: 'success',
    result: {
      type: 'TABL/DT',
      name: 'eban',
      children: [field('banfn', true, 'char', 10), field('werks', false, 'char', 4)],
    },
  });
  assert.equal(text, 'EBAN（TABL/DT）共 2 个字段：\nBANFN 键 BANFN char(10)\nWERKS WERKS char(4)');
  assert.equal(
    formatResult('runQuery', { status: 'success', result: { rows: [] } }),
    '{"status":"success","result":{"rows":[]}}',
  );
});

test('openSap exposes only offered whitelist tools with clean schemas', async () => {
  const offered = [...SAP_TOOLS.slice(0, 3), 'setObjectSource', 'deleteObject'].map((name) => ({
    name,
    description: name + ' tool',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      properties: {},
    },
  }));
  const calls = [];
  const sap = await openSap(
    null,
    {},
    {
      resolve: async () => ({ env: {}, target: { systemCode: 'S4H', client: '100' } }),
      connect: async () => ({
        tools: offered,
        call: async (name, args) => {
          calls.push(name);
          return {
            content: [{ type: 'text', text: JSON.stringify({ status: 'success', data: args }) }],
          };
        },
        close: async () => {},
      }),
    },
  );
  assert.equal(sap.available, true);
  assert.deepEqual(
    sap.tools.map((t) => t.function.name),
    SAP_TOOLS.slice(0, 3),
  );
  assert.equal(sap.tools[0].function.parameters.$schema, undefined);
  assert.equal((await sap.call('deleteObject', {})).status, 'denied');
  assert.equal((await sap.call('searchObject', { query: 'EBAN' })).status, 'ok');
  assert.deepEqual(calls, ['searchObject']);
});

test('openSap reports why SAP is unavailable instead of failing the turn', async () => {
  const noConfig = await openSap(null, {}, { resolve: () => Promise.reject(new Error('未配置')) });
  assert.equal(noConfig.available, false);
  assert.match(noConfig.reason, /未配置/);
  const down = await openSap(
    null,
    {},
    {
      resolve: async () => ({ env: {}, target: { systemCode: 'S4H' } }),
      connect: () => Promise.reject(new Error('网络不通')),
    },
  );
  assert.equal(down.available, false);
  assert.match(down.reason, /网络不通/);
});
