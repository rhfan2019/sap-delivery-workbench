import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspace } from '../../../../apps/api/src/modules/abap-dev-agent/tools/workspace.mjs';
import {
  loadSystemPrompt,
  sessionFacts,
} from '../../../../apps/api/src/modules/abap-dev-agent/context.mjs';
import { markChanges } from '../../../../apps/api/src/modules/abap-dev-agent/materials.mjs';

function workspace(over = {}) {
  const saved = [];
  const ws = createWorkspace({
    plan: '## 3.2 文本元素\n| m01 | x |',
    code: 'REPORT z.\nWRITE 1.\n',
    materials: [
      {
        key: 'attachment:a1',
        type: 'attachment',
        label: '对话附件 z.abap',
        text: 'REPORT z.\nWRITE 2.\n',
      },
    ],
    programs: ['ZPROG'],
    readProgram: async () => 'REPORT zprog.\nINCLUDE zinc.\n',
    onSave: async (v) => {
      saved.push(v);
      return saved.length + 1;
    },
    ...over,
  });
  return { ...ws, saved };
}

test('writing and editing record declarations and check the code', async () => {
  const { state, handlers } = workspace({ code: '', plan: '' });
  await assert.rejects(
    handlers.write_artifact({ target: 'code', mode: 'replace', content: 'x' }),
    /changes/,
  );
  const out = await handlers.write_artifact({
    target: 'code',
    mode: 'replace',
    content: '```abap\nREPORT z.\nIF a = 1.\n```',
    changes: [{ section: '全部', summary: '初稿' }],
  });
  assert.equal(state.code, 'REPORT z.\nIF a = 1.\n');
  assert.match(out, /开发方案为空/);
  assert.match(out, /没有对应的 ENDIF/);
  await handlers.edit_artifact({
    target: 'code',
    old_text: 'IF a = 1.',
    new_text: 'WRITE 1.',
    reason: '简化',
  });
  assert.equal(state.declarations[1].line, 2);
  assert.equal(state.changed, true);
  assert.match(handlers.read_artifact({ target: 'code' }), /2 {2}WRITE 1\./);
});

test('hand-backs are saved at once and the diff comes back', async () => {
  const { state, handlers, saved } = workspace();
  await assert.rejects(
    handlers.import_code({ attachment_id: 'zz', reason: '用户确认' }),
    /没有这个/,
  );
  const out = await handlers.import_code({ attachment_id: 'a1', reason: '用户确认是修改后的代码' });
  assert.match(out, /已保存为第 2 版/);
  assert.match(out, /- WRITE 1\.\n\+ WRITE 2\./);
  assert.deepEqual(saved[0].source, 'upload');
  assert.equal(state.changed, false);
  assert.equal(state.base.code, state.code);

  await assert.rejects(handlers.sync_from_sap({ object_name: 'ZOTHER' }), /不是本开发项/);
  const synced = await handlers.sync_from_sap({});
  assert.match(synced, /INCLUDE/);
  assert.equal(saved[1].sourceRef, 'PROG ZPROG');
  const none = workspace({ programs: [] });
  await assert.rejects(none.handlers.sync_from_sap({}), /尚未登记程序对象/);
});

test('reports and functions load the report rules and example; other kinds do not', async () => {
  const report = await loadSystemPrompt('function');
  assert.match(report, /开发类型规范：可执行程序/);
  assert.match(report, /REPORT ydemo_frh_0021/);
  const other = await loadSystemPrompt('interface');
  assert.doesNotMatch(other, /开发类型规范：可执行程序|REPORT ydemo/);
});

test('facts warn about unsupported kinds, optimizations and missing SAP', () => {
  const facts = sessionFacts({
    scope: {
      itemCode: '00001',
      itemName: 'x',
      projectName: 'p',
      itemKind: 'interface',
      changeType: 'optimize',
    },
    sap: { available: false, reason: '未配置' },
    objects: [],
    materials: markChanges(
      [{ key: 'item', type: 'item', label: '开发清单信息', digest: '1' }],
      [{ key: 'item', digest: '0' }],
    ),
    version: null,
    comments: [],
    today: '2026-10-14',
  });
  assert.match(facts, /不支持生成代码/);
  assert.match(facts, /只开发新对象/);
  assert.match(facts, /SAP 工具本轮不可用/);
  assert.match(facts, /【有变化】开发清单信息/);
  assert.match(facts, /还没有开发方案和代码/);
});

test('a reply cannot claim a change the program does not see', async () => {
  const replies = [];
  const { handlers } = workspace({
    comments: [{ id: 'c1', target: 'code', status: 'open' }],
    onReply: async (id, body) => replies.push(body),
  });
  await assert.rejects(
    handlers.reply_comment({ comment_id: 'c1', reply: '已重构' }),
    /没有任何改动/,
  );
  assert.equal(
    await handlers.reply_comment({ comment_id: 'c1', reply: '不改：原因', no_change: true }),
    '已回复批注。',
  );
  await handlers.edit_artifact({
    target: 'code',
    old_text: 'WRITE 1.',
    new_text: 'WRITE 3.',
    reason: '按批注',
    comment_id: 'c1',
  });
  await handlers.reply_comment({ comment_id: 'c1', reply: '已修改' });
  assert.deepEqual(replies, ['不改：原因', '已修改']);
});

test('without an FSD or a plan the facts say to write only the plan first', () => {
  const base = {
    scope: {
      itemCode: '1',
      itemName: 'x',
      projectName: 'p',
      itemKind: 'report',
      changeType: 'new',
    },
    sap: { available: false, reason: 'x' },
    objects: [],
    comments: [],
    today: '2026-10-15',
  };
  const fsd = [{ key: 'fsd:s:1', type: 'fsd', label: 'FSD 第 1 版', digest: 'd' }];
  assert.match(sessionFacts({ ...base, materials: [], version: null }), /本轮只写开发方案/);
  assert.doesNotMatch(sessionFacts({ ...base, materials: fsd, version: null }), /没有 FSD/);
  const planned = { version: 1, source: 'assistant', plan: '## 1', code: '', labels: [] };
  assert.match(sessionFacts({ ...base, materials: [], version: planned }), /开发方案已有版本/);
});
