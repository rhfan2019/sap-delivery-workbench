import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { compile } from 'json-schema-to-typescript';

const root = new URL('../packages/contracts/fs-workspace/', import.meta.url);
const registry = JSON.parse(await readFile(new URL('registry.json', root), 'utf8'));
const documents = new Map();
for (const entry of registry.schemas)
  documents.set(entry.id, JSON.parse(await readFile(new URL(entry.path, root), 'utf8')));

function expand(value, document, ancestors = []) {
  if (Array.isArray(value)) return value.map((v) => expand(v, document, ancestors));
  if (!value || typeof value !== 'object') return value;
  if (value.$ref) {
    const [id, fragment] = value.$ref.split('#');
    const owner = id ? documents.get(id) : document;
    if (!owner) throw new Error(`Non-local reference: ${value.$ref}`);
    const key = `${owner.$id}#${fragment ?? ''}`;
    if (ancestors.includes(key))
      throw new Error(`Recursive schema requires explicit generator support: ${key}`);
    const target = fragment
      ? fragment
          .slice(1)
          .split('/')
          .reduce((v, p) => v[p.replaceAll('~1', '/').replaceAll('~0', '~')], owner)
      : owner;
    return expand(target, owner, [...ancestors, key]);
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([k]) => !['$id', '$schema', '$defs', 'title'].includes(k))
      .map(([k, v]) => [
        k,
        ['properties', 'patternProperties'].includes(k)
          ? Object.fromEntries(
              Object.entries(v).map(([name, schema]) => [
                name,
                expand(schema, document, ancestors),
              ]),
            )
          : expand(v, document, ancestors),
      ]),
  );
}

let output = '// Generated from packages/contracts/fs-workspace JSON Schema. DO NOT EDIT.\n';
for (const entry of [...registry.schemas].sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
  const schema = documents.get(entry.id);
  output +=
    '\n' +
    (await compile(expand(schema, schema), entry.name, {
      bannerComment: '',
      ignoreMinAndMaxItems: true,
    }));
}
const path = new URL('generated/types.ts', root);
if (process.argv.includes('--check')) {
  if ((await readFile(path, 'utf8')) !== output)
    throw new Error('Generated FS types are stale; run npm run generate:fs');
} else {
  await mkdir(new URL('generated/', root), { recursive: true });
  await writeFile(path, output);
}
