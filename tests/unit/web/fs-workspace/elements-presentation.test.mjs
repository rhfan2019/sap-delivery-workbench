import test from 'node:test';
import assert from 'node:assert/strict';
import {
  composerState,
  restoreDraft,
  stepPresentation,
} from '../../../../apps/web/src/features/assistant-ui/presentation.mjs';

test('composer keeps stop separate from submitting and respects readonly/loading gates', () => {
  assert.deepEqual(
    composerState({
      busy: true,
      stopping: false,
      blocked: true,
      loading: false,
      text: 'next',
      modelId: 'm',
    }),
    { status: 'streaming', canSend: false, canStop: true },
  );
  assert.equal(composerState({ busy: true, stopping: true }).canStop, false);
  for (const patch of [{ blocked: true }, { loading: true }, { text: '  ' }, { modelId: '' }])
    assert.equal(composerState({ text: 'hello', modelId: 'm', ...patch }).canSend, false);
  assert.equal(composerState({ text: 'hello', modelId: 'm' }).canSend, true);
});
test('failed previous request never overwrites a new draft', () => {
  assert.equal(restoreDraft('next message', 'old message'), 'next message');
  assert.equal(restoreDraft('', 'old message'), 'old message');
});
test('step presentation preserves queued, waiting and cancelled semantics', () => {
  assert.equal(stepPresentation('queued').label, '等待执行');
  assert.equal(stepPresentation('waiting_user').label, '等待确认');
  assert.equal(stepPresentation('cancelled').label, '已停止');
  assert.equal(stepPresentation('succeeded').label, '已完成');
  assert.equal(stepPresentation('unknown').label, '状态待同步');
});
