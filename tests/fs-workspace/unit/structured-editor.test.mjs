import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
test('empty structured arrays can create a schema-shaped first item without example business facts', async () => {
  const { newArrayItem } =
    await import('../../../apps/web/src/features/item-workspace/editor-schema.mjs');
  const schema = JSON.parse(
    await readFile('packages/contracts/abap-fsd-agent/fsd/v1/r.schema.json', 'utf8'),
  );
  const item = newArrayItem(schema.properties.sapObjects, schema, {
    sapObjects: [{ id: 'OBJ-001' }],
  });
  assert.equal(item.id, 'OBJ-002');
  assert.equal(item.name, '');
  assert.equal(item.verificationStatus, 'unverified');
  assert.deepEqual(item.evidenceIds, []);
  assert.equal(newArrayItem({ items: { type: 'string' } }, schema, {}), '');
});
