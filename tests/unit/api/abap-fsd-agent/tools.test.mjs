import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createWorkspace,
  validateQuestions,
} from '../../../../apps/api/src/modules/abap-fsd-agent/tools/workspace.mjs';

const question = (over = {}) => ({
  question: '逾期按哪个日期判断？',
  background: '影响逾期标识',
  options: [
    { label: '计划发货日', impact: 'A' },
    { label: '交货日期', impact: 'B' },
  ],
  recommended: '计划发货日',
  reason: '与发货考核一致',
  why_customer: '属于客户口径，系统查不到',
  ...over,
});

test('question batches are capped at five and must be complete', () => {
  assert.equal(validateQuestions([question()]), null);
  assert.match(validateQuestions(Array(6).fill(question())), /最多 5 题/);
  assert.match(validateQuestions([question({ why_customer: '' })]), /why_customer/);
  assert.match(validateQuestions([question({ recommended: '其他' })]), /推荐选项/);
  assert.match(validateQuestions([question({ options: [{ label: 'x', impact: 'y' }] })]), /2～4/);
});

test('workspace tools write, edit with reasons and record declarations', async () => {
  const drafts = [];
  const replies = [];
  const { state, handlers } = createWorkspace({
    comments: [{ id: 'c1' }],
    onDocument: (md) => drafts.push(md),
    onReply: async (id, body) => replies.push([id, body]),
  });
  await assert.rejects(
    handlers.write_document({ mode: 'replace', content: '# x', changes: [] }),
    /changes/,
  );
  const written = await handlers.write_document({
    mode: 'replace',
    content: '## 1.1 开发概览\n旧',
    changes: [{ section: '1.1 开发概览', summary: '初稿' }],
  });
  assert.match(written, /缺少章节/);
  await handlers.write_document({
    mode: 'append',
    content: '## 1.2 业务需求描述\n需求',
    changes: [{ section: '1.2', summary: '续写' }],
  });
  // An append declares every heading it brings, even when `changes` names only the parent.
  assert.deepEqual(state.declarations.at(-1).sections, ['1.2', '1.2 业务需求描述']);
  await assert.rejects(
    handlers.edit_document({ old_text: '旧', new_text: '新', reason: '' }),
    /理由/,
  );
  await assert.rejects(
    handlers.edit_document({ old_text: '旧', new_text: '新', reason: 'r', comment_id: 'nope' }),
    /批注编号/,
  );
  await handlers.edit_document({
    old_text: '旧',
    new_text: '新',
    reason: '按批注',
    comment_id: 'c1',
  });
  assert.equal(state.markdown, '## 1.1 开发概览\n新\n\n## 1.2 业务需求描述\n需求\n');
  assert.equal(state.declarations.at(-1).commentId, 'c1');
  assert.deepEqual(state.declarations.at(-1).sections, ['1.1 开发概览']);
  assert.equal(drafts.length, 3);
  assert.match(await handlers.read_document({ section: '1.2' }), /需求/);
  await handlers.reply_comment({ comment_id: 'c1', reply: '已改为“新”' });
  assert.deepEqual(replies, [['c1', '已改为“新”']]);
  assert.match(await handlers.ask_user({ questions: [question()] }), /等待答复/);
  assert.equal(state.questions.length, 1);
});
