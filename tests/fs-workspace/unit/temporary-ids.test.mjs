import test from 'node:test';
import assert from 'node:assert/strict';
import { mapTemporaryIds } from '../../../apps/api/src/fs-workspace/changes/entities.mjs';

test('nested new blocks and rows receive stable IDs without rewriting business text', () => {
  const operations = [
    {
      op: 'replace',
      entity_type: 'section',
      target_id: 'section',
      value: {
        id: 'section',
        blocks: [
          { id: 'tmp:block', text: 'tmp:block', rows: [{ id: 'tmp:row', cells: ['tmp:row'] }] },
        ],
      },
    },
  ];
  const mapped = mapTemporaryIds(operations);
  assert.match(mapped[0].value.blocks[0].id, /^[a-f0-9-]{36}$/);
  assert.match(mapped[0].value.blocks[0].rows[0].id, /^[a-f0-9-]{36}$/);
  assert.equal(mapped[0].value.blocks[0].text, 'tmp:block');
  assert.deepEqual(mapped[0].value.blocks[0].rows[0].cells, ['tmp:row']);
  assert.equal(operations[0].value.blocks[0].id, 'tmp:block');
});

test('duplicate temporary declarations and undefined references are rejected', () => {
  const duplicate = [
    {
      op: 'add',
      entity_type: 'section',
      target_id: 'tmp:s',
      value: { id: 'tmp:s', blocks: [{ id: 'tmp:b' }, { id: 'tmp:b' }] },
    },
  ];
  assert.throws(() => mapTemporaryIds(duplicate), /唯一/);
  assert.throws(
    () =>
      mapTemporaryIds([
        {
          op: 'replace',
          entity_type: 'block',
          target_id: 'b',
          value: { id: 'b', rule_ids: ['tmp:missing'] },
        },
      ]),
    /未.*定义/,
  );
});
