import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as s from '../../../../apps/api/src/modules/agent-runtime/specification.mjs';
const example = () =>
  JSON.parse(
    readFileSync(
      new URL(import.meta.resolve('@sap-delivery-workbench/contracts/agent-runtime/fsd/v1/r.example.json')),
    ),
  );
test('draft rejects truncated JSON and forged evidence, confirmation and wrong type', () => {
  assert.throws(() => s.parseDraft('{"riceType":"R"'));
  const good = example();
  assert.equal(s.validateDraft(good).valid, true);
  good.evidence = [{ id: 'EV-001' }];
  assert.equal(s.validateDraft(good).valid, false);
  const confirmed = example();
  confirmed.rules[0].decision.status = 'consultant_confirmed';
  assert.equal(s.validateDraft(confirmed).valid, false);
  const wrong = example();
  wrong.riceType = 'I';
  assert.equal(s.validateDraft(wrong).valid, false);
});
test('markdown derives fields, rules, tests and unresolved evidence from same JSON', () => {
  const m = s.renderMarkdown(example());
  assert.match(m, /business_id/);
  assert.match(m, /RULE-001/);
  assert.match(m, /TEST-001/);
  assert.match(m, /ISSUE-001/);
  assert.match(m, /未核验|unverified/);
});

test('readable FSD expresses decisions as prose rather than JSON object dumps', () => {
  const m = s.renderMarkdown(example());
  assert.doesNotMatch(m, /"status":|"value":|"issueIds":/);
  assert.match(m, /建议|待确认/);
});
