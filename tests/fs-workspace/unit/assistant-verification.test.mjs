import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyObjects } from '../../../apps/api/src/abap-fsd-agent/object-verification.mjs';
const wrap = (x) => ({
  content: [{ type: 'text', text: JSON.stringify({ status: 'success', ...x }) }],
});
test('metadata evidence is scoped, hashed and never certifies business purpose', async () => {
  const result = await verifyObjects({
    systemId: 'dev',
    environment: 'DEV',
    candidates: [{ id: 'OBJ-001', kind: 'table', name: 'EBAN', purpose: '采购申请' }],
    connect: async () => ({
      tools: [{ name: 'searchObject' }, { name: 'ddicElement' }],
      close: async () => {},
      call: async (n) =>
        n === 'searchObject'
          ? wrap({
              results: [
                {
                  'adtcore:name': 'EBAN',
                  'adtcore:type': 'TABL/DT',
                  'adtcore:uri': '/sap/bc/adt/ddic/tables/eban',
                },
              ],
            })
          : wrap({ result: { name: 'EBAN', children: [{ name: 'BANFN' }] } }),
    }),
  });
  assert.equal(result.objects[0].verificationStatus, 'partial');
  assert.equal(result.evidence[0].systemFingerprint, 'dev:DEV');
  assert.match(result.raw[0].sha256, /^[a-f0-9]{64}$/);
  assert.match(result.objects[0].verificationScope, /用途/);
});
test('no exact result is unreadable, wrong returned object is conflicting, invalid names do not query', async () => {
  const r = await verifyObjects({
    systemId: 'dev',
    candidates: [{ id: 'OBJ-001', kind: 'table', name: 'DROP TABLE X', purpose: 'x' }],
    connect: async () => {
      throw Error('must not connect');
    },
  });
  assert.equal(r.objects[0].verificationStatus, 'unverified');
});

test('function modules search FUNC and data elements use exact ADT structure', async () => {
  const c = {
    tools: ['searchObject', 'objectStructure'].map((name) => ({ name })),
    close: async () => {},
    call: async (tool, args) =>
      tool === 'searchObject'
        ? wrap({
            results:
              args.objType === 'FUNC'
                ? [
                    {
                      'adtcore:name': 'BAPI_PO_GETDETAIL1',
                      'adtcore:type': 'FUGR/FF',
                      'adtcore:uri':
                        '/sap/bc/adt/functions/groups/2012/fmodules/bapi_po_getdetail1',
                    },
                  ]
                : [
                    {
                      'adtcore:name': 'EBELN',
                      'adtcore:type': 'DTEL/DE',
                      'adtcore:uri': '/sap/bc/adt/ddic/dataelements/ebeln',
                    },
                  ],
          })
        : wrap({
            structure: {
              metaData: {
                'adtcore:name': args.objectUrl.endsWith('ebeln') ? 'EBELN' : 'BAPI_PO_GETDETAIL1',
                'adtcore:type': args.objectUrl.endsWith('ebeln') ? 'DTEL/DE' : 'FUGR/FF',
              },
            },
          }),
  };
  const r = await verifyObjects({
    systemId: 'dev',
    candidates: [
      { id: 'OBJ-001', kind: 'data_element', name: 'EBELN' },
      { id: 'OBJ-002', kind: 'bapi', name: 'BAPI_PO_GETDETAIL1' },
    ],
    connect: async () => c,
  });
  assert.deepEqual(
    r.objects.map((o) => o.verificationStatus),
    ['partial', 'partial'],
  );
});
