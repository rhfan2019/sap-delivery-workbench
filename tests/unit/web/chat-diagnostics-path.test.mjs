import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { ref } from 'vue';
const source = await readFile(
  'apps/web/src/features/fs-assistant-test/RunDiagnosticsView.vue',
  'utf8',
);
const script = source
  .split('<script setup lang="ts">')[1]
  .split('</script>')[0]
  .replace(/import[^;]+;\s*/g, '');
const js = ts.transpileModule(script + '\nreturn {load,error};', {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const prefix =
  '/projects/11111111-1111-1111-1111-111111111111/development-items/22222222-2222-2222-2222-222222222222/work/';
async function inspect(base) {
  const calls = [];
  const deps = {
    ref,
    useRoute: () => ({ query: { base }, params: { runId: 'run/unsafe' } }),
    onMounted: () => {},
    onBeforeUnmount: () => {},
    api: async (path) => {
      calls.push(path);
      return {};
    },
  };
  const view = new Function(...Object.keys(deps), js)(...Object.values(deps));
  await view.load();
  return { calls, error: view.error.value };
}
test('diagnostics accepts exact new chat path and existing agent paths', async () => {
  for (const base of [
    '/admin/abap-fsd-agent',
    prefix + 'design/agent',
    prefix + 'development/agent',
    prefix + 'design/fsd/v1/chat',
  ]) {
    const result = await inspect(base);
    assert.equal(result.error, '', base);
    assert.deepEqual(result.calls, [base + '/runs/run%2Funsafe/diagnostics']);
  }
});
test('diagnostics rejects malformed or broader new chat routes without requesting them', async () => {
  for (const base of [
    prefix + 'development/fsd/v1/chat',
    prefix + 'design/fsd/v1/chat/extra',
    prefix + 'design/fsd/v1/chat?x=1',
    prefix + 'design/fsd/v2/chat',
    'https://example.test' + prefix + 'design/fsd/v1/chat',
    prefix.replace('11111111', 'invalid') + 'design/fsd/v1/chat',
  ]) {
    const result = await inspect(base);
    assert.equal(result.error, '日志入口无效', base);
    assert.deepEqual(result.calls, []);
  }
});
