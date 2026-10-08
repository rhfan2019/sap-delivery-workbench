import { chromium, expect } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
const entry = new URL('../../../.runtime/fsd-issues-entry.mjs', import.meta.url);
writeFileSync(
  entry,
  `import {createApp,h} from 'vue';
import Decision from '/src/features/fs-assistant-test/DecisionCard.vue';
import Timeline from '/src/features/fs-assistant-test/ConversationTimeline.vue';
import Steps from '/src/features/fs-assistant-test/RunSteps.vue';
import Composer from '/src/features/fs-assistant-test/ChatComposer.vue';
import Workflow from '/src/features/fs-assistant-test/WorkflowPanel.vue';
import '/src/assets/theme.css'; import '/src/assets/main.css'; import '/src/assets/elements.css';
import '/src/features/item-workspace/workspace.css';
const steps=[{stepId:'generate',label:'生成初稿',status:'succeeded',summary:'已保存',attempt:1}];
const decision={id:'d1',message:'确认业务口径',questions:[{id:'q1',title:'逾期如何计算？',allowText:true,options:[{value:'a',label:'按计划交货日期计算逾期',description:'以计划交货日期和当前日期比较，排除已完成交货的订单行。',recommended:true},{value:'b',label:'按订单创建日期计算',description:'保留全部历史订单。'}]}]};
createApp({render(){return h('div',{class:'item-workspace assistant-elements',style:'height:auto;max-width:1000px;margin:auto'},[
h(Workflow,{base:'/issue-harness',conversationId:'s',busy:false,readonly:false}),
h(Timeline,{messages:[{id:'u',role:'user',authorName:'测试顾问账号较长的显示名称',createdAt:'2026-10-06T02:00:00Z',content:'生成FSD',status:'completed'},{id:'a',role:'assistant',content:'{"title":"技术输出"}',status:'completed',runId:'run'}],busy:false,statusLabel:''},{progress:()=>h(Steps,{steps})}),
h(Decision,{decision,busy:false,onAnswer:v=>window.answer=v}),
h(Composer,{modelValue:'生成FSD',modelId:'m',models:[],busy:false,blocked:false,loading:false,stopping:false,dragging:false})])}}).mount('#app');`,
);
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
mkdirSync('.runtime/artifacts/fsd-issues', { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let n = 1,
    broken = false,
    posted;
  const state = () => ({
    phase: 'draft_review',
    version: n,
    activeRevisionId: 'a' + n,
    activeContentHash: String(n).repeat(64),
    activeRevision: n,
    activeArtifact: {
      id: 'a' + n,
      revision: n,
      contentHash: String(n).repeat(64),
      markdown: broken
        ? ''
        : '# 初稿业务规则\n\n按计划交货日计算逾期。\n\n|字段|说明|\n|---|---|\n|交货日|计划日期|',
      spec: { issues: [] },
    },
    revisions: [],
    activeRunId: null,
  });
  await page.route('**/issue-harness/conversations/s/workflow', async (route) => {
    if (route.request().method() === 'POST') posted = route.request().postDataJSON();
    await route.fulfill({ json: state() });
  });
  await page.route('**/fsd-issues-harness', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<html lang="zh"><head><meta charset="utf-8"></head><body><div id="app"></div><script type="module" src="/@fs/${entry.pathname.replace(/^\//, '')}"></script></body></html>`,
    }),
  );
  await page.goto('http://127.0.0.1:5173/fsd-issues-harness');
  await expect(page.getByText('按计划交货日计算逾期。', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '确认初稿 v1' })).toBeDisabled();
  await page.getByRole('button', { name: '审阅当前 v1' }).click();
  await expect(page.getByRole('button', { name: '确认初稿 v1' })).toBeEnabled();
  await page.getByRole('button', { name: '确认初稿 v1' }).click();
  assert.equal(posted.revisionId, 'a1');
  assert.equal(posted.contentHash, '1'.repeat(64));
  n = 2;
  await page.getByRole('button', { name: '刷新状态' }).click();
  await expect(page.getByRole('button', { name: '确认初稿 v2' })).toBeDisabled();
  await page.getByRole('button', { name: '审阅当前 v2' }).click();
  await expect(page.getByRole('button', { name: '确认初稿 v2' })).toBeEnabled();
  await page.screenshot({ path: '.runtime/artifacts/fsd-issues/review.png', fullPage: true });
  broken = true;
  n = 3;
  await page.getByRole('button', { name: '刷新状态' }).click();
  await expect(page.getByRole('button', { name: '确认初稿 v3' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '审阅当前 v3' })).toBeDisabled();
  const radio = page.locator('.decision-card input[type=radio]').first();
  const bounds = await radio.boundingBox();
  assert.ok(bounds.width <= 20 && bounds.height <= 20, JSON.stringify(bounds));
  const label = await page.locator('.decision-card label > span').first().boundingBox();
  assert.ok(label.width > 300);
  await page.getByRole('button', { name: '选择全部推荐' }).click();
  await expect(radio).toBeChecked();
  await page.getByRole('button', { name: '确认并继续' }).click();
  assert.deepEqual(await page.evaluate(() => window.answer), { q1: 'a' });
  const alignment = await page.locator('[aria-label="发送信息"]').evaluate((el) => ({
    justify: getComputedStyle(el).justifyContent,
    align: getComputedStyle(el).textAlign,
  }));
  assert.deepEqual(alignment, { justify: 'flex-end', align: 'right' });
  const progress = await page.getByRole('region', { name: '执行步骤' }).count();
  const order = await page.evaluate(() => {
    const a = document.querySelector('[aria-label="执行步骤"]'),
      b = [...document.querySelectorAll('summary')].find((x) => x.textContent.includes('技术输出'));
    return !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  assert.equal(order, true);
  const textarea = page.getByRole('textbox', { name: '输入消息' });
  await textarea.focus();
  const focus = await textarea.evaluate((el) => ({
    border: getComputedStyle(el).borderTopWidth,
    outline: getComputedStyle(el).outlineStyle,
    shadow: getComputedStyle(el.closest('[data-slot="input-group"]')).boxShadow,
  }));
  assert.equal(focus.border, '0px');
  assert.equal(focus.outline, 'none');
  assert.notEqual(focus.shadow, 'none');
  await page.screenshot({ path: '.runtime/artifacts/fsd-issues/ui-1280.png', fullPage: true });
  await page.setViewportSize({ width: 1024, height: 900 });
  const narrow = await page.locator('.decision-card label > span').first().boundingBox();
  assert.ok(narrow.width > 300);
  await page.screenshot({ path: '.runtime/artifacts/fsd-issues/ui-1024.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    'PASS: readable saved revision, hash binding, stale and missing review blocking, radio layout/actions, message alignment, progress order, single focus indicator; 1280/1024 desktop.',
  );
} finally {
  await browser.close();
}
