import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { ref, watch, nextTick, effectScope } from 'vue';
test('new session first file request survives session invalidation and settles loading', async () => {
  const source = await readFile(
    'apps/web/src/features/item-workspace/ItemWorkspaceView.vue',
    'utf8',
  );
  const refresh = source.slice(
    source.indexOf('async function refreshFiles()'),
    source.indexOf('async function inspectFile'),
  );
  const watchIndex = source.search(/watch\(\s*sessionId,\s*\(\)\s*=>/);
  assert.notEqual(watchIndex, -1);
  const invalidation = source.slice(watchIndex, source.indexOf('</script>', watchIndex));
  const body = ts.transpileModule(refresh + '\n' + invalidation + '\nreturn refreshFiles;', {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const sessionId = ref('old'),
    files = ref({ inputs: [], outputs: [] }),
    filePreview = ref(null),
    filesLoading = ref(false),
    error = ref('');
  let complete;
  const api = () => new Promise((r) => (complete = r));
  const scope = effectScope();
  const run = scope.run(() =>
    new Function(
      'watch',
      'sessionId',
      'files',
      'filePreview',
      'filesLoading',
      'error',
      'api',
      'controller',
      'base',
      'let filesEpoch=0;' + body,
    )(
      watch,
      sessionId,
      files,
      filePreview,
      filesLoading,
      error,
      api,
      new AbortController(),
      '/work',
    ),
  );
  sessionId.value = 'new';
  const pending = run();
  await nextTick();
  complete({ inputs: [{ id: 'new-file' }], outputs: [] });
  await pending;
  assert.equal(files.value.inputs[0]?.id, 'new-file');
  assert.equal(filesLoading.value, false);
  scope.stop();
});
