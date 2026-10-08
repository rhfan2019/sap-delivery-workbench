import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { schemas } from '@sap-delivery-workbench/contracts/fs-workspace';

const spec = new URL(
  '../../../fixtures/fs-workspace/specification/',
  import.meta.url,
);
const read = async (path) => JSON.parse(await readFile(new URL(path, spec), 'utf8'));
test('design schemas and runtime proposal/domain schemas stay synchronized', async () => {
  for (const file of (await readdir(new URL('schemas/', spec))).filter((f) =>
    f.endsWith('.schema.json'),
  )) {
    const original = await read('schemas/' + file);
    assert.deepEqual(schemas[file.replace('.schema.json', '')], original);
  }
});
test('OpenAPI components retain the runtime DTO shapes', async () => {
  const api = await read('api.openapi.json');
  const normalize = (value) => {
    if (Array.isArray(value)) return value.map(normalize);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(
      Object.entries(value)
        .filter(([k]) => !['$schema', '$id', 'title'].includes(k))
        .map(([k, v]) => [
          k,
          k === '$ref'
            ? v
                .replace('#/components/schemas/', 'https://fs-workspace.example/http/')
                .replace('./schemas/', 'https://fs-workspace.example/schemas/')
                .replace(/\/http\/([^/.]+)$/, '/http/$1.schema.json')
            : normalize(v),
        ]),
    );
  };
  for (const [name, schema] of Object.entries(api.components.schemas))
    if (!schema.$ref) assert.deepEqual(normalize(schemas[name]), normalize(schema), name);
});
