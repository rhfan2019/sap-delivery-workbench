import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { loadRules } from '../apps/api/src/abap-fsd-agent/ruleset.mjs';
import { promptRecord } from '../apps/api/src/abap-fsd-agent/prompts.mjs';
const root = new URL('../packages/agents/abap-fsd-agent/v1/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8'));
const names = new Set(),
  ids = new Set();
for (const m of manifest.modules) {
  assert.ok(!names.has(m.file) && !ids.has(m.id), 'Duplicate rule module');
  names.add(m.file);
  ids.add(m.id);
  assert.ok(
    !m.file.includes('\\') &&
      !m.file.startsWith('/') &&
      !m.file.includes(':') &&
      m.file.split('/').every((p) => p && p !== '.' && p !== '..'),
    'Invalid manifest path',
  );
  const text = readFileSync(new URL(m.file, root), 'utf8');
  assert.ok(text.trim(), `Empty rule: ${m.file}`);
  if (manifest.integrity !== 'runtime-sha256')
    assert.equal(
      createHash('sha256').update(text).digest('hex'),
      m.sha256,
      `Stale hash: ${m.file}`,
    );
}
const protocol = readFileSync(new URL(manifest.protocolFile, root), 'utf8');
const templates = [...protocol.matchAll(/^## ([a-z][a-z-]*)\s*$/gm)].map((m) => m[1]);
for (const name of templates) promptRecord(name);
assert.deepEqual(manifest.common, manifest.profiles.dialogue);
let combinations = 0;
loadRules();
combinations++;
for (const task of ['draft', 'review', 'verify', 'plan', 'revise'])
  for (const riceType of ['R', 'I', 'C', 'E'])
    for (const practices of [
      [],
      ['editable_batch'],
      ['object_feedback'],
      ['editable_batch', 'object_feedback'],
    ]) {
      const r = loadRules({ task, riceType, practices });
      assert.ok(r.rules.some((v) => v.file === manifest.types[riceType]));
      assert.ok(
        r.rules.every(
          (v) =>
            !v.file.startsWith('维护/') &&
            !v.file.startsWith('验收/') &&
            !v.file.startsWith('渲染/'),
        ),
      );
      combinations++;
    }
const schemaRoot = new URL('../packages/contracts/abap-fsd-agent/fsd/v1/', import.meta.url);
for (const t of ['r', 'i', 'c', 'e'])
  assert.equal(
    JSON.parse(readFileSync(new URL(`${t}.schema.json`, schemaRoot))).properties.schemaVersion
      .const,
    manifest.contractVersion,
  );
console.log(
  JSON.stringify({
    modules: manifest.modules.length,
    combinations,
    dialogueBytes: Buffer.byteLength(
      loadRules()
        .rules.map((r) => r.text)
        .join('\n'),
    ),
    status: 'passed',
  }),
);
