import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
test('type generation preserves business fields named title at every nesting level', async () => {
  const text = await readFile(
    new URL('../../../packages/contracts/fs-workspace/generated/types.ts', import.meta.url),
    'utf8',
  );
  assert.match(text, /export interface SessionCreate \{\s+title: string;/);
  const doc = text
    .split('export interface FsDocument {')[1]
    .split('export interface FsProjectRoleAssignment')[0];
  assert.ok((doc.match(/title: string/g) ?? []).length >= 3);
});
