import test from 'node:test';
import assert from 'node:assert/strict';
import {
  guardSapCall,
  openSap,
  truncate,
  formatResult,
  SAP_TOOLS,
} from '../../../../apps/api/src/modules/abap-fsd-agent/tools/sap.mjs';
import {
  createWorkspace,
  validateQuestions,
} from '../../../../apps/api/src/modules/abap-fsd-agent/tools/workspace.mjs';

test('only whitelisted read tools pass; SQL must be a single SELECT; limits are clamped', () => {
  assert.match(guardSapCall('setObjectSource', {}), /白名单/);
  assert.match(guardSapCall('runClass', {}), /白名单/);
  assert.match(guardSapCall('runQuery', { sqlQuery: 'DELETE FROM TVAK' }), /SELECT/);
  assert.match(
    guardSapCall('runQuery', { sqlQuery: 'SELECT * FROM TVAK; DROP TABLE X' }),
    /SELECT/,
  );
  const args = { sqlQuery: 'SELECT AUART, VBTYP FROM TVAK', rowNumber: 5000 };
  assert.equal(guardSapCall('runQuery', args), null);
  assert.equal(args.rowNumber, 100);
  const source = { objectSourceUrl: 'x', maxLines: 99999 };
  assert.equal(guardSapCall('getObjectSource', source), null);
  assert.equal(source.maxLines, 400);
  assert.match(truncate('x'.repeat(30000)), /已截断/);
  assert.match(
    guardSapCall('tableContents', { ddicEntityName: 'T000', sqlQuery: 'DELETE FROM T000' }),
    /SELECT/,
  );
  assert.equal(guardSapCall('tableContents', { ddicEntityName: 'T000' }), null);
});

test('table definitions are reduced to one line per field', () => {
  const field = (name, key, type, length) => ({
    type: 'TABL/DTF',
    name,
    properties: {
      elementProps: {
        ddicIsKey: key,
        ddicDataElement: name,
        ddicDataType: type,
        ddicLength: length,
      },
    },
  });
  const text = formatResult('ddicElement', {
    status: 'success',
    result: {
      type: 'TABL/DT',
      name: 'eban',
      children: [field('banfn', true, 'char', 10), field('werks', false, 'char', 4)],
    },
  });
  assert.equal(text, 'EBAN（TABL/DT）共 2 个字段：\nBANFN 键 BANFN char(10)\nWERKS WERKS char(4)');
  assert.equal(
    formatResult('runQuery', { status: 'success', result: { rows: [] } }),
    '{"status":"success","result":{"rows":[]}}',
  );
});

test('openSap exposes only offered whitelist tools with clean schemas', async () => {
  const offered = [...SAP_TOOLS.slice(0, 3), 'setObjectSource', 'deleteObject'].map((name) => ({
    name,
    description: name + ' tool',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      properties: {},
    },
  }));
  const calls = [];
  const sap = await openSap(
    null,
    {},
    {
      resolve: async () => ({ env: {}, target: { systemCode: 'S4H', client: '100' } }),
      connect: async () => ({
        tools: offered,
        call: async (name, args) => {
          calls.push(name);
          return {
            content: [{ type: 'text', text: JSON.stringify({ status: 'success', data: args }) }],
          };
        },
        close: async () => {},
      }),
    },
  );
  assert.equal(sap.available, true);
  assert.deepEqual(
    sap.tools.map((t) => t.function.name),
    SAP_TOOLS.slice(0, 3),
  );
  assert.equal(sap.tools[0].function.parameters.$schema, undefined);
  assert.equal((await sap.call('deleteObject', {})).status, 'denied');
  assert.equal((await sap.call('searchObject', { query: 'EBAN' })).status, 'ok');
  assert.deepEqual(calls, ['searchObject']);
});

test('openSap reports why SAP is unavailable instead of failing the turn', async () => {
  const noConfig = await openSap(null, {}, { resolve: () => Promise.reject(new Error('未配置')) });
  assert.equal(noConfig.available, false);
  assert.match(noConfig.reason, /未配置/);
  const down = await openSap(
    null,
    {},
    {
      resolve: async () => ({ env: {}, target: { systemCode: 'S4H' } }),
      connect: () => Promise.reject(new Error('网络不通')),
    },
  );
  assert.equal(down.available, false);
  assert.match(down.reason, /网络不通/);
});

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
    changes: [{ section: '1.2 业务需求描述', summary: '续写' }],
  });
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
