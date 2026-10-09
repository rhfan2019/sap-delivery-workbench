import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import * as vue from 'vue';
import * as workflow from '../../../apps/web/src/features/fs-assistant-test/workflowActions.mjs';

test('active chat workflow refreshes through completion and stops timers on disposal', async () => {
  const source = (
    await readFile('apps/web/src/features/fs-assistant-test/WorkflowPanel.vue', 'utf8')
  )
    .split('<script setup lang="ts">')[1]
    .split('</script>')[0]
    .replace(/import[\s\S]*?from ['"][^'"]+['"];\s*/g, '');
  const js = ts.transpileModule(source + '\nreturn {refresh,state};', {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  let dispose,
    timer,
    calls = 0;
  const deps = {
    ...workflow,
    ref: vue.ref,
    computed: vue.computed,
    watch: () => {},
    onErrorCaptured: () => {},
    onBeforeUnmount: (fn) => (dispose = fn),
    defineProps: () => ({ base: '/work/design/fsd/v1/chat', conversationId: 'c', busy: false }),
    defineEmits: () => () => {},
    api: async () => ({
      phase: ++calls === 1 ? 'final_review' : 'completed',
      activeRunId: calls === 1 ? 'r' : null,
      revisions: [],
    }),
    ApiError: Error,
    setTimeout: (fn) => {
      timer = fn;
      return 1;
    },
    clearTimeout: () => {
      timer = null;
    },
    crypto,
  };
  const panel = new Function(...Object.keys(deps), js)(...Object.values(deps));
  await panel.refresh();
  assert.equal(typeof timer, 'function');
  await timer();
  assert.equal(panel.state.value.phase, 'completed');
  assert.equal(timer, null);
  dispose();
  assert.equal(timer, null);
});
