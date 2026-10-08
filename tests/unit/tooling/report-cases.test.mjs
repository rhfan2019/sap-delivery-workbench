import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseReportCases, requirementHtml } from '../../../scripts/maintenance/report-cases.mjs';
test('report import splits modules, keeps original wording and safely encodes rich text', () => {
  const cases = parseReportCases(
    '### 一、MM 模块（1个案例）\n#### 案例1：库存分析（复杂批处理）\n原文 A < B\n- 不改写\n### 二、SD 模块（1个案例）\n#### 案例1：销售清单（普通报表）\n需求二',
  );
  assert.equal(cases.length, 2);
  assert.equal(cases[0].key, 'MM-01');
  assert.equal(cases[1].key, 'SD-01');
  assert.equal(cases[0].name, '库存分析');
  assert.equal(cases[0].originalKind, '复杂批处理');
  assert.equal(cases[0].summary, '原文 A < B\n- 不改写');
  assert.equal(requirementHtml(cases[0].summary), '<p>原文 A &lt; B</p><p>- 不改写</p>');
  assert.throws(() => parseReportCases('#### 案例1：缺少模块\nx'));
});
