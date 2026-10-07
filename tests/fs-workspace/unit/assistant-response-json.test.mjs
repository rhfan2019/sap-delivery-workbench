import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { modelDecision } from '../../../apps/api/src/abap-fsd-agent/decisions.mjs';
import { parseDraft } from '../../../apps/api/src/abap-fsd-agent/specification.mjs';
const actual = readFileSync(
  new URL('../fixtures/clarification-with-preamble.txt', import.meta.url),
  'utf8',
);
test('actual failed run: prose before complete clarification still renders three questions', () => {
  const d = modelDecision(actual);
  assert.equal(d?.questions.length, 3);
  assert.equal(d.questions[0].options.length, 3);
});
test('one complete object tolerates fences, prose, escaped quotes and braces in strings', () => {
  const obj = { title: '值包含 } 和 \\" 字符', nested: { x: [1, 2] } };
  assert.deepEqual(parseDraft('说明\n```json\n' + JSON.stringify(obj) + '\n```\n结束'), obj);
});
test('never choose one of multiple objects, salvage nested or truncated JSON, or accept arrays', () => {
  for (const text of [
    '说明 {"a":1} {"b":2}',
    '说明 {"a":{"b":2}',
    '[{"a":1}]',
    '说明 {"a":1,}',
    '说明 {"a":1} {',
  ])
    assert.throws(() => parseDraft(text), text);
});
test('invalid decision schema is still rejected after wrapper removal', () => {
  assert.throws(() => modelDecision('说明 {"kind":"clarification","questions":[]}'));
});
