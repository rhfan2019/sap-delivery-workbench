import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  renderMarkdown,
  validateDraft,
} from '../../../../apps/api/src/modules/agent-runtime/specification.mjs';
import { validateSpecContract } from '@sap-delivery-workbench/contracts/agent-runtime/validator';
const example = (type = 'r') =>
  JSON.parse(
    readFileSync(
      new URL(
        `../../../../packages/contracts/agent-runtime/fsd/v1/${type}.example.json`,
        import.meta.url,
      ),
      'utf8',
    ),
  );
const proposed = (value) => ({ status: 'proposed', value, issueIds: [] });

test('legacy report renders consultant chapters and ordered selection/output/test tables', () => {
  const spec = example();
  const markdown = renderMarkdown(spec);
  assert.match(markdown, /^## 1 开发需求部分$/m);
  assert.match(markdown, /^### 1\.1 开发概览$/m);
  assert.match(markdown, /^### 1\.2 业务需求描述$/m);
  assert.match(markdown, /^## 2 功能规范$/m);
  assert.match(markdown, /^### 2\.2 选择屏幕设计及其布局$/m);
  assert.match(
    markdown,
    /\| 字段名称 \| 输入方式 \| 参考来源 \| 必填\/可选 \| 业务说明 \| 默认值 \|/,
  );
  assert.match(markdown, /\| 字段\/列标题 \| 来源或计算 \| 类型及长度 \| 显示与编辑要求 \|/);
  assert.match(markdown, /^## 3 业务逻辑$/m);
  assert.match(markdown, /^## 4 开发测试数据$/m);
  assert.match(markdown, /\| 序号 \| 场景 \| 数据\/前置条件 \| 预期结果 \| 验证方法 \|/);
  assert.equal(validateDraft(spec).valid, true);
});

test('permission chapter body is strictly empty before selection heading', () => {
  const markdown = renderMarkdown(example());
  assert.equal(markdown.split('### 2.1 权限设计')[1]?.split('### 2.2')[0].trim(), '');
});

test('main consultant view replaces reference IDs and protocol enums while appendix preserves traceability', () => {
  const markdown = renderMarkdown(example());
  const [main, appendix] = markdown.split('## 附录');
  assert.doesNotMatch(main, /(?:SPEC|FIELD|REQ|RULE|TEST|ISSUE|OBJ|SRC)-\d+/);
  assert.doesNotMatch(main, /\b(?:input|output|proposed|open|unverified|string)\b/);
  assert.match(main, /建议：/);
  assert.match(appendix, /FIELD-001/);
  assert.match(appendix, /REQ-001/);
  assert.match(appendix, /RULE-001/);
  assert.match(appendix, /TEST-001/);
  assert.match(appendix, /ISSUE-001/);
});

test('optional consultant details are additive and open decisions retain issue meaning', () => {
  const spec = example();
  spec.consultantDetails = {
    executionMode: proposed('前台按需查询'),
    users: proposed('库存分析人员'),
    outputMode: proposed('明细列表'),
    selectionLayout: proposed('先业务范围再日期'),
    outputLayout: { status: 'open', value: null, issueIds: ['ISSUE-001'] },
  };
  spec.fields[0].businessLabel = '业务编号';
  spec.fields[0].inputStyle = proposed('单值或区间');
  spec.fields[1].businessLabel = '结果编号';
  spec.fields[1].displayRule = proposed('只读并允许排序');
  assert.equal(validateDraft(spec).valid, true);
  const main = renderMarkdown(spec).split('## 附录')[0];
  assert.match(main, /前台按需查询/);
  assert.match(main, /业务编号/);
  assert.match(main, /单值或区间/);
  assert.match(main, /只读并允许排序/);
  assert.match(main, /待确认：未提供/);
  assert.match(main, /后端产品、版本和候选对象未核验/);
  spec.consultantDetails.outputLayout.issueIds = ['ISSUE-999'];
  assert.equal(validateDraft(spec).valid, false);
});

test('consultant additions cannot forge confirmation and all existing RICE examples stay compatible', () => {
  for (const type of ['r', 'i', 'c', 'e']) {
    const spec = example(type);
    spec.fields[0].businessLabel = '业务编号';
    assert.equal(validateSpecContract(spec).valid, true, type);
    assert.ok(renderMarkdown(spec).includes(spec.title));
  }
  const spec = example();
  spec.consultantDetails = {
    outputLayout: { status: 'consultant_confirmed', value: '正式版式', issueIds: [] },
  };
  assert.equal(validateDraft(spec).valid, false);
});

test('table text cannot inject extra columns, headings or HTML and rendering is deterministic', () => {
  const spec = example();
  spec.fields[0].businessMeaning = '编号 | 备注\n### 假标题 <script>alert(1)</script>';
  const markdown = renderMarkdown(spec);
  assert.doesNotMatch(markdown, /^### 假标题/m);
  assert.doesNotMatch(markdown, /<script>/);
  assert.match(markdown, /编号 \\?\| 备注/);
  assert.equal(renderMarkdown(spec), markdown);
});

test('business logic labels hide contract property names without losing data-source and calculation meaning', () => {
  const main = renderMarkdown(example()).split('## 附录')[0];
  assert.doesNotMatch(main, /dataSources|calculationRuleIds|reportPurpose/);
  assert.match(main, /\| 数据来源 \| 候选对象尚未确定（未核验）：候选结果来源 \|/);
  assert.match(main, /\| 计算规则 \| 保留输入的业务标识并按功能规则输出 \|/);
});

test('legacy interface, migration and enhancement views resolve entity references and business labels', () => {
  for (const type of ['i', 'c', 'e']) {
    const main = renderMarkdown(example(type)).split('## 附录')[0];
    assert.doesNotMatch(main, /(?:FIELD|REQ|RULE|TEST|ISSUE|OBJ|SRC)-\d+/, type);
    assert.doesNotMatch(
      main,
      /mappingRuleIds|enhancementObjectId|transactionBoundary|businessObjects/,
      type,
    );
    assert.doesNotMatch(main, /\b(?:input|output|inout|synchronous|asynchronous)\b/, type);
  }
});
