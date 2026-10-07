import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRules } from '../../../apps/api/src/abap-fsd-agent/ruleset.mjs';
import {
  validateSpecContract,
  validateReviewContract,
} from '../../../packages/contracts/abap-fsd-agent/fsd/v1/validate.mjs';
import { readFileSync } from 'node:fs';
const fixture = (type = 'r') =>
  JSON.parse(
    readFileSync(
      new URL(
        `../../../packages/contracts/abap-fsd-agent/fsd/v1/${type}.example.json`,
        import.meta.url,
      ),
    ),
  );
test('rules are selected by task/type and runtime capability, not whole-directory concatenation', () => {
  const d = loadRules();
  assert.ok(d.rules.length > 1);
  assert.ok(d.rules.every((r) => r.sha256.length === 64));
  assert.ok(!d.rules.some((r) => r.file.startsWith('类型/') || r.file.startsWith('验收/')));
  const r = loadRules({ task: 'draft', riceType: 'R', practices: ['editable_batch'] });
  assert.ok(r.rules.some((r) => r.file === '类型/报表功能规则.md'));
  assert.ok(r.rules.some((r) => r.file === '实践/可编辑批处理与并发.md'));
  assert.ok(!r.rules.some((r) => r.file === '类型/接口功能规则.md'));
  assert.throws(() => loadRules({ task: 'draft', riceType: 'F' }));
  assert.throws(() => loadRules({ task: 'unknown' }));
  assert.throws(() => loadRules({ practices: ['../../secret'] }));
});
test('FSD contracts accept partial discovery, reject broken references and report missing test coverage', () => {
  for (const t of ['r', 'i', 'c', 'e']) {
    const s = fixture(t);
    s.systemContext.discoveryStatus = 'partial';
    assert.equal(validateSpecContract(s).valid, true);
  }
  const s = fixture();
  s.rules[0].requirementIds = ['REQ-999'];
  assert.equal(validateSpecContract(s).valid, false);
  const d = fixture();
  d.fields[1].id = d.fields[0].id;
  assert.equal(validateSpecContract(d).valid, false);
  const u = fixture();
  u.requirements.push({ ...u.requirements[0], id: 'REQ-002' });
  assert.ok(
    validateSpecContract(u).qualityIssues.some((i) => i.code === 'requirement_without_test'),
  );
  assert.equal(validateSpecContract(u).valid, true);
});
test('accepted issues stay unresolved and confirmation cannot bind a different version or hash', () => {
  const s = fixture();
  s.issues[0].status = 'accepted';
  s.issues[0].resolution = '顾问知悉，后续核验';
  const e = {
    specId: s.specId,
    revision: s.revision,
    status: 'awaiting_confirmation',
    verificationSummary: 'unverified',
    unresolvedIssueIds: ['ISSUE-001'],
    confirmation: null,
  };
  assert.equal(validateReviewContract(s, e, { contentSha256: 'a'.repeat(64) }).valid, true);
  assert.equal(
    validateReviewContract(s, { ...e, unresolvedIssueIds: [] }, { contentSha256: 'a'.repeat(64) })
      .valid,
    false,
  );
  const complete = {
    ...e,
    status: 'completed',
    confirmation: {
      actorId: 'user',
      confirmedAt: '2026-10-04T08:00:00Z',
      specId: s.specId,
      revision: 1,
      contentSha256: 'a'.repeat(64),
      decision: 'confirm_complete',
      acknowledgedIssueIds: ['ISSUE-001'],
      note: '知悉问题',
    },
  };
  assert.equal(validateReviewContract(s, complete, { contentSha256: 'a'.repeat(64) }).valid, true);
  assert.equal(validateReviewContract(s, complete, { contentSha256: 'b'.repeat(64) }).valid, false);
  complete.confirmation.revision = 2;
  assert.equal(validateReviewContract(s, complete, { contentSha256: 'a'.repeat(64) }).valid, false);
});
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
function temporaryPackage(t, file = 'rule.md', text = 'allowed') {
  const root = mkdtempSync(path.join(tmpdir(), 'fsd-rule-test-'));
  t.after(() => {
    const relative = path.relative(path.resolve(tmpdir()), path.resolve(root));
    if (relative.includes(path.sep) || !relative.startsWith('fsd-rule-test-'))
      throw new Error('Unsafe temporary cleanup path');
    rmSync(root, { recursive: true, force: true });
  });
  const manifest = {
    version: 'test',
    contractVersion: '1.0.0',
    profiles: { dialogue: [file] },
    practices: {},
    types: {},
    modules: [{ file, loadable: true, sha256: createHash('sha256').update(text).digest('hex') }],
  };
  writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest));
  if (file === 'rule.md') writeFileSync(path.join(root, file), text);
  return root;
}
test('loader refuses traversal, tampered rules and non-loadable metadata', (t) => {
  const root = temporaryPackage(t);
  writeFileSync(path.join(root, 'rule.md'), 'tampered');
  assert.throws(() => loadRules({ rootPath: root }), /hash/);
  assert.throws(() => loadRules({ rootPath: temporaryPackage(t, '../outside.md') }), /path/);
  const blocked = temporaryPackage(t);
  const p = path.join(blocked, 'manifest.json');
  const m = JSON.parse(readFileSync(p));
  m.modules[0].loadable = false;
  writeFileSync(p, JSON.stringify(m));
  assert.throws(() => loadRules({ rootPath: blocked }), /path/);
});
test('validator is fail-closed for unsupported type and direction, but content gaps are advisory', () => {
  for (const riceType of ['F', '__proto__', 'constructor'])
    assert.equal(validateSpecContract({ riceType }).valid, false);
  const s = fixture();
  s.contract.outputFieldIds = [s.fields[0].id];
  assert.equal(validateSpecContract(s).valid, false);
  const gap = fixture();
  gap.tests[0].expectedResult = '正确';
  assert.equal(validateSpecContract(gap).valid, true);
  assert.equal(validateSpecContract(gap).qualityIssues[0].code, 'vague_expected_result');
  const pending = fixture();
  pending.issues[0].status = 'resolved';
  pending.issues[0].resolution = '补充资料并完成核对';
  const e = {
    specId: pending.specId,
    revision: pending.revision,
    status: 'awaiting_confirmation',
    verificationSummary: 'unverified',
    unresolvedIssueIds: [],
    confirmation: null,
  };
  assert.equal(validateReviewContract(pending, e).valid, true);
});
