import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkDocument,
  formatCheck,
  REQUIRED_SECTIONS,
} from '../../../../apps/api/src/modules/abap-fsd-agent/tools/check.mjs';

const exempt = '无需测试案例：本功能只有静态说明，没有可执行的取数逻辑。';
// Bodies the content checks look for: the document scope in 1.2, the display column in 2.4.
const bodies = { 1.2: '**单据范围**\n内容', 2.4: '字段表含默认显示列', '附录 D': exempt };
const complete = REQUIRED_SECTIONS.map(([n, t]) => `## ${n} ${t}\n${bodies[n] ?? '内容'}`).join(
  '\n\n',
);

const row = (cells) => `| ${cells.join(' | ')} |`;
// The skeleton with real sections 3.1 and 3.2 and a fully structured appendix D.
const withTests = (data, cases) =>
  [
    complete.replace(`## 附录 D 测试案例\n${exempt}`, ''),
    '## 3.1 数据查询\n内容',
    '## 3.2 状态判定\n内容',
    '# 附录 D 测试案例',
    '## D.1 测试范围与策略\n覆盖状态与取数。',
    [
      '## D.2 测试数据需求',
      row(['数据编号', '对象', '数据特征', '核实条件', '准备建议']),
      row(Array(5).fill('---')),
      ...data.map(row),
    ].join('\n'),
    [
      '## D.3 测试案例',
      row(['编号', '场景', '维度', '类型', '测试数据', '操作', '预期结果', '对应条款', '优先级']),
      row(Array(9).fill('---')),
      ...cases.map(row),
    ].join('\n'),
    '## D.4 未覆盖与待补\n- 无。',
  ].join('\n\n');
const goodData = [
  ['TD-01', '生产订单', '部分收货', '`AFPO-WEMNG` > 0 且 < `AFPO-PSMNG`', '查找已有单据'],
  ['TD-02', '生产订单', '已删除标记', '`JEST-STAT` = I0076', '需新建：下达后设置删除标记'],
];
const goodCases = [
  [
    'TC-01',
    '部分收货显示剩余',
    '取数',
    '正向',
    'TD-01',
    '工厂 1010 执行',
    '出现 1000123',
    '3.1',
    'P1',
  ],
  ['TC-02', 'TECO 不显示', '状态、生命周期', '排除', 'TD-01', '同上', '不出现', '3.2、3.1', 'P1'],
  ['TC-03', '无数据', '消息', '边界', '—', '工厂 9999', '提示无数据', '3.1', 'P2'],
];

test('a complete skeleton passes; missing sections are named', async () => {
  assert.equal((await checkDocument(complete)).ok, true);
  const result = await checkDocument(complete.replace('## 2.5 功能按钮', '## 2.5 其他'));
  assert.deepEqual(
    result.problems.map((p) => p.message),
    ['缺少章节：2.5 功能按钮'],
  );
  assert.match(formatCheck(result), /未决事项/);
});

test('tables need a separator row and consistent columns; references must exist', async () => {
  const bad =
    complete +
    '\n\n## 3.1 数据查询\n| 字段 | 参照 |\n| --- | --- |\n| A | B | C |\n\n| 无分隔 | 行 |\n| x | y |\n见 3.9';
  const kinds = (await checkDocument(bad)).problems.map((p) => p.message);
  assert.ok(kinds.some((m) => /第 3 行列数/.test(m)));
  assert.ok(kinds.some((m) => /缺少表头分隔行/.test(m)));
  assert.ok(kinds.some((m) => /见 3.9/.test(m)));
  assert.ok(!kinds.some((m) => /见 3.1/.test(m)));
});

test('table and field references are verified against SAP definitions', async () => {
  const calls = [];
  const result = await checkDocument(complete + '\n取 EBAN-WERKS、EBAN-NOPE 和 ZZFAKE-COL', {
    verifyTable: async (t) => {
      calls.push(t);
      return t === 'EBAN' ? '{"fields":["BANFN","WERKS"]}' : null;
    },
  });
  assert.deepEqual(calls, ['EBAN', 'ZZFAKE']);
  calls.length = 0;
  await checkDocument(complete + '\n测试系统 SELF-S4H-2020 中的 EBAN-WERKS', {
    ignoreRefs: ['SELF-S4H-2020'],
    verifyTable: async (t) => (calls.push(t), '{"fields":["WERKS"]}'),
  });
  assert.deepEqual(calls, ['EBAN']);
  assert.deepEqual(result.verified.unknownFields, ['EBAN-NOPE']);
  assert.deepEqual(result.verified.unknownTables, ['ZZFAKE']);
  assert.equal(result.ok, false);
});

test('appendix D: a structured appendix passes; an exemption needs a stated reason', async () => {
  const result = await checkDocument(withTests(goodData, goodCases));
  assert.deepEqual(result.problems, []);
  const bare = await checkDocument(complete.replace(exempt, '略'));
  assert.ok(bare.problems.some((p) => /缺少 D\.1～D\.4/.test(p.message)));
});

test('appendix D: columns, vocabularies and references are enforced', async () => {
  const messages = (
    await checkDocument(
      withTests(
        [['TD-01', '生产订单', '—', '—', '查找']],
        [
          ['T1', '场景', '性能', '随便', 'TD-09', '执行', '符合预期', '3.9', 'P4'],
          ['TC-02', '场景', '取数', '正向', '—', '执行', '出现', '附录 C', 'P1'],
        ],
      ),
    )
  ).problems.map((p) => p.message);
  for (const pattern of [
    /“T1”应写成 TC-01/,
    /维度“性能”/,
    /类型“随便”/,
    /不存在的测试数据 TD-09/,
    /T1 的预期结果/,
    /不存在的章节 3\.9/,
    /优先级“P4”/,
    /TC-02 没有写对应的正文条款/,
    /TD-01 没有写数据特征/,
    /TD-01 没有写核实条件/,
  ])
    assert.ok(
      messages.some((m) => pattern.test(m)),
      pattern,
    );

  const renamed = withTests(goodData, goodCases).replace('| 编号 | 场景 |', '| 编号 | 名称 |');
  assert.ok(
    (await checkDocument(renamed)).problems.some((p) => /D\.3 测试案例 的表头应为/.test(p.message)),
  );
  const missing = withTests(goodData, goodCases).replace('## D.4 未覆盖与待补', '## D.4 其他');
  assert.ok(
    (await checkDocument(missing)).problems.some(
      (p) => p.message === '附录 D 缺少小节：D.4 未覆盖',
    ),
  );
});

test('appendix D: data requirements carry no document numbers (contract 1.12)', async () => {
  const old = withTests(goodData, goodCases)
    .replace(
      '| 数据编号 | 对象 | 数据特征 | 核实条件 | 准备建议 |',
      '| 数据编号 | 对象 | 单据号 | 数据特征 | 核实条件 |',
    )
    .replace('## D.2 测试数据需求', '## D.2 测试数据');
  const messages = (await checkDocument(old)).problems.map((p) => p.message);
  assert.ok(messages.includes('附录 D 缺少小节：D.2 测试数据需求'));
  assert.ok(
    messages.some((m) => /表头应为：数据编号 \| 对象 \| 数据特征 \| 核实条件 \| 准备建议/.test(m)),
  );
});

test('1.2 needs the document scope and 2.4 the default display column', async () => {
  const withoutScope = complete.replace('**单据范围**\n内容', '只有标准订单');
  assert.ok(
    (await checkDocument(withoutScope)).problems.some((p) => /1\.2 缺少“单据范围”/.test(p.message)),
  );
  const withoutDisplay = complete.replace('字段表含默认显示列', '字段表');
  assert.ok((await checkDocument(withoutDisplay)).problems.some((p) => /默认显示/.test(p.message)));
  // A sub-heading under 1.2 still counts as part of the chapter.
  const nested = complete.replace('**单据范围**\n内容', '内容\n\n### 单据范围\n全部类别');
  assert.equal((await checkDocument(nested)).ok, true);
});
