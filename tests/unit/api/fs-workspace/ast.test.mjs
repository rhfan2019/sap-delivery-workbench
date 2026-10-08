import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateDocument,
  documentHash,
  canonicalJson,
} from '../../../../apps/api/src/modules/fs-workspace/document/ast.mjs';
import { toRenderModel } from '../../../../apps/api/src/modules/fs-workspace/export/render-model.mjs';
import { document, template } from '../../../fixtures/fs-workspace/document.mjs';

test('table_shape_must_match_columns and paragraph cannot hide table content', () => {
  const d = document(),
    b = d.sections[0].blocks[0];
  b.kind = 'table';
  b.text = null;
  b.columns = ['字段', '说明'];
  b.rows = [{ id: 'row-1', cells: ['only-one'] }];
  assert.ok(validateDocument(d, template, {}).some((f) => f.rule_id === 'TABLE_SHAPE_MISMATCH'));
  b.kind = 'paragraph';
  b.text = 'visible';
  assert.ok(validateDocument(d, template, {}).some((f) => f.rule_id === 'BLOCK_SHAPE_MISMATCH'));
});
test('required_template_slots_present and duplicate_stable_id_rejected', () => {
  const d = document();
  d.sections.pop();
  d.sections[1].blocks[0].id = d.sections[0].blocks[0].id;
  const findings = validateDocument(d, template, {});
  assert.ok(findings.some((f) => f.rule_id === 'TEMPLATE_SLOT_REQUIRED'));
  assert.ok(findings.some((f) => f.rule_id === 'DUPLICATE_STABLE_ID'));
});
test('pending drafts can be saved but release remains blocked', () => {
  const d = document();
  d.sections[0].blocks[0].classification = 'pending';
  const findings = validateDocument(d, template, {});
  assert.equal(
    findings.some((f) => f.blocking === 'review'),
    false,
  );
  assert.ok(findings.some((f) => f.rule_id === 'PENDING_CONTENT' && f.blocking === 'release'));
});
test('template_upgrade_does_not_change_old_version and hashes cover actual content', () => {
  const d = document(),
    before = structuredClone(d),
    t = structuredClone(template);
  const hash = documentHash(d, t),
    render = toRenderModel(d, t);
  assert.equal(toRenderModel(d, t).content_hash, render.content_hash);
  assert.equal(
    documentHash({ ...d, created_at: 'different', id: 'new', revision: 2, version_number: 3 }, t),
    hash,
  );
  assert.equal(canonicalJson({ z: 1, a: 2 }), canonicalJson({ a: 2, z: 1 }));
  assert.equal(
    canonicalJson(Object.assign(Object.create(null), { a: 2 })),
    canonicalJson({ a: 2 }),
  );
  t.version = '2.0.0';
  t.hash = 'changed';
  assert.notEqual(documentHash(d, t), hash);
  assert.deepEqual(d, before);
  const revised = structuredClone(d);
  revised.sections[0].blocks[0].text += '改变';
  assert.notEqual(documentHash(revised, template), hash);
});
test('cross-document test references and unsafe revisions are rejected', () => {
  const d = document();
  d.revision = Number.MAX_SAFE_INTEGER + 1;
  assert.ok(validateDocument(d, template, {}).some((f) => f.rule_id === 'UNSAFE_INTEGER'));
});

test('top-level references must resolve to the pinned manifest and entity kind', () => {
  const d = document();
  d.rule_refs = ['foreign-rule'];
  d.evidence_manifest_ids = ['foreign-evidence'];
  const findings = validateDocument(d, template, {
    entities: [{ id: 'foreign-rule', kind: 'requirement' }],
    evidence: [],
  });
  assert.ok(findings.some((f) => f.rule_id === 'REF_NOT_FOUND' && f.path === '/rule_refs'));
  assert.ok(
    findings.some(
      (f) => f.rule_id === 'EVIDENCE_REF_NOT_FOUND' && f.path === '/evidence_manifest_ids',
    ),
  );
});

test('test case references cannot bypass pinned entity validation', () => {
  const d = document();
  d.tests = [
    {
      id: 'test-1',
      title: '验证',
      preconditions: [],
      steps: ['执行'],
      expected: ['成功'],
      requirement_ids: ['missing'],
      rule_ids: [],
      section_ids: [],
      evidence_refs: [],
    },
  ];
  assert.ok(
    validateDocument(d, template, {}).some(
      (f) => f.rule_id === 'REF_NOT_FOUND' && f.path === '/tests/0/requirement_ids',
    ),
  );
});
