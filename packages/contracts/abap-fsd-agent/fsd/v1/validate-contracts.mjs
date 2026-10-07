import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const root = new URL('./', import.meta.url);
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const report = {
  purpose: 'Design-contract validation only; no SAP or business test executed',
  schemaDraft: '2020-12',
  checks: [],
};
function check(name, fn) {
  fn();
  report.checks.push({ name, result: 'PASS' });
}
const parse = async (name) => JSON.parse(await fs.readFile(new URL(name, root), 'utf8'));
for (const type of ['r', 'i', 'c', 'e']) {
  const schema = await parse(type + '.schema.json');
  const validate = ajv.compile(schema);
  const sample = await parse(type + '.example.json');
  check(type + ': sample accepted', () =>
    assert.ok(validate(sample), JSON.stringify(validate.errors)),
  );
  const mutation = (name, mutate) =>
    check(type + ': ' + name, () => {
      const value = structuredClone(sample);
      mutate(value);
      assert.equal(validate(value), false);
    });
  mutation('wrong type rejected', (v) => (v.riceType = 'F'));
  mutation('missing contract rejected', (v) => delete v.contract);
  mutation('unknown property rejected', (v) => (v.fakeApproval = true));
  mutation(
    'missing type-specific field rejected',
    (v) => delete v.contract[Object.keys(v.contract)[0]],
  );
  mutation('open decision without issue rejected', (v) => (v.systemContext.product.issueIds = []));
  mutation(
    'empty confirmed value rejected',
    (v) => (v.rules[0].decision = { status: 'consultant_confirmed', value: '', issueIds: [] }),
  );
  mutation(
    'verified object without evidence rejected',
    (v) => (v.sapObjects[0].verificationStatus = 'verified'),
  );
  mutation('invalid revision rejected', (v) => (v.revision = 0));
  mutation('accepted issue without disposition rejected', (v) => (v.issues[0].status = 'accepted'));
  mutation('empty tests rejected', (v) => (v.tests = []));
  mutation('missing field semantics rejected', (v) => delete v.fields[0].businessMeaning);
}
const envelope = ajv.compile(await parse('review-envelope.schema.json'));
const pending = {
  specId: 'SPEC-001',
  revision: 1,
  status: 'awaiting_confirmation',
  verificationSummary: 'unverified',
  unresolvedIssueIds: ['ISSUE-001'],
  confirmation: null,
};
check('review: pending without confirmation accepted', () =>
  assert.ok(envelope(pending), JSON.stringify(envelope.errors)),
);
check('review: completion without confirmation rejected', () =>
  assert.equal(envelope({ ...pending, status: 'completed' }), false),
);
const complete = {
  ...pending,
  status: 'completed',
  confirmation: {
    actorId: 'consultant-example',
    confirmedAt: '2026-10-04T08:00:00Z',
    specId: 'SPEC-001',
    revision: 1,
    contentSha256: 'a'.repeat(64),
    decision: 'confirm_complete',
    acknowledgedIssueIds: ['ISSUE-001'],
    note: '示例：顾问确认完成，遗留问题继续记录；不是实际批准',
  },
};
check('review: completion with unresolved issues and confirmation accepted', () =>
  assert.ok(envelope(complete), JSON.stringify(envelope.errors)),
);
check('review: malformed digest rejected', () =>
  assert.equal(
    envelope({ ...complete, confirmation: { ...complete.confirmation, contentSha256: 'fake' } }),
    false,
  ),
);
report.summary = { passed: report.checks.length, failed: 0 };
await fs.writeFile(new URL('validation-report.json', root), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report.summary));
