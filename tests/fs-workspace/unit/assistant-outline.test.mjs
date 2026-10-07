import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createOutline,
  visibleOutline,
} from '../../../apps/web/src/features/fs-assistant-test/outline.mjs';
test('Chinese duplicate and empty headings have unique stable anchors and real hierarchy', () => {
  const input = [
    { level: 1, text: '报表' },
    { level: 2, text: '业务逻辑' },
    { level: 4, text: '业务逻辑' },
    { level: 2, text: '' },
  ];
  const outline = createOutline(input, 'fsd-v1');
  assert.equal(new Set(outline.map((h) => h.id)).size, 4);
  assert.deepEqual(outline, createOutline(input, 'fsd-v1'));
  assert.equal(outline[2].parentId, outline[1].id);
  assert.equal(outline[2].depth, 2);
  assert.equal(outline[3].label, '未命名章节');
  assert.deepEqual(
    visibleOutline(outline, new Set([outline[1].id])).map((h) => h.id),
    [outline[0].id, outline[1].id, outline[3].id],
  );
});
