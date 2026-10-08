import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probeSystem } from '../../../apps/api/src/modules/sap/probe.mjs';
const envelope = (result) => ({
  content: [{ type: 'text', text: JSON.stringify({ status: 'success', result }) }],
});
test('SAP probe reads CVERS through MCP and always closes connection', async () => {
  let closed = false;
  const result = await probeSystem(
    {},
    {
      connect: async () => ({
        tools: [{ name: 'tableContents' }],
        call: async (name, args) => {
          assert.equal(name, 'tableContents');
          assert.equal(args.ddicEntityName, 'CVERS');
          return envelope([
            { COMPONENT: 'SAP_BASIS', RELEASE: '758' },
            { COMPONENT: 'S4CORE', RELEASE: '108' },
          ]);
        },
        close: async () => {
          closed = true;
        },
      }),
    },
  );
  assert.equal(result.status, 'passed');
  assert.match(result.version, /SAP_BASIS 758/);
  assert.match(result.version, /S4CORE 108/);
  assert.equal(closed, true);
});
for (const [source, code] of [
  ['HTTP 401 password=secret', 'AUTH_FAILED'],
  ['HTTP 403 secret', 'FORBIDDEN'],
  ['ETIMEDOUT secret', 'TIMEOUT'],
  ['ECONNREFUSED secret', 'NETWORK'],
]) {
  test('SAP probe classifies ' + code + ' without disclosing credentials', async () => {
    const result = await probeSystem(
      {},
      {
        connect: async () => ({
          tools: [{ name: 'tableContents' }],
          call: async () => ({
            isError: true,
            content: [{ type: 'text', text: JSON.stringify({ error: source }) }],
          }),
          close: async () => {},
        }),
      },
    );
    assert.equal(result.status, 'failed');
    assert.equal(result.code, code);
    assert.doesNotMatch(JSON.stringify(result), /secret/);
  });
}
test('SAP probe does not accept malformed/empty version evidence', async () => {
  const result = await probeSystem(
    {},
    {
      connect: async () => ({
        tools: [{ name: 'tableContents' }],
        call: async () => envelope([]),
        close: async () => {},
      }),
    },
  );
  assert.equal(result.status, 'failed');
  assert.equal(result.version, null);
});
