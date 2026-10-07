// Explicit read-only replay: at most TWO provider requests, no SAP or business writes.
import { connectDatabase } from './lib/database.mjs';
import { getModel } from '../apps/api/src/models/store.mjs';
import { openKey } from '../apps/api/src/models/crypto.mjs';
import { streamText } from '../apps/api/src/abap-fsd-agent/model-stream.mjs';
import { buildContext } from '../apps/api/src/abap-fsd-agent/context.mjs';
import {
  draftInstructions,
  parseDraft,
  validateDraft,
} from '../apps/api/src/abap-fsd-agent/specification.mjs';
import {
  renderTechnicalOutput,
  extractConfirmedAnswers,
} from '../apps/api/src/abap-fsd-agent/feedback.mjs';
import { writeFile } from 'node:fs/promises';
if (process.argv[2] !== '--real-model')
  throw new Error('Explicit --real-model authorization required');
const id = 'de567be0-88b0-41e2-90a5-fee711cca22e';
const db = await connectDatabase();
let run, model, key;
try {
  await db.query('BEGIN READ ONLY');
  ({
    rows: [run],
  } = await db.query('SELECT * FROM app.fsd_agent_run WHERE id=$1', [id]));
  if (!run) throw new Error('Reported run missing');
  model = await getModel(db, run.organization_id, run.snapshot.input.modelId);
  const {
    rows: [credential],
  } = await db.query(
    'SELECT secret_cipher FROM app.llm_credential WHERE organization_id=$1 AND id=$2',
    [run.organization_id, model.credentialId],
  );
  key = openKey(credential.secret_cipher, run.organization_id, model.credentialId);
  await db.query('ROLLBACK');
} finally {
  await db.end();
}
const s = run.snapshot;
if (
  model.config.modelId !== s.input.model.modelId ||
  model.config.provider !== s.input.model.provider
)
  throw new Error('Original model configuration changed; replay stopped');
const decisions = [...(s.decisions ?? []), ...extractConfirmedAnswers(s.messages, s.prompt)];
const itemSource = s.manifest.sources.find((source) => source.id === 'SRC-002');
const context = buildContext({
  messages: s.messages,
  currentMessage: s.prompt,
  task: 'draft',
  riceType: 'R',
  budget: 700000,
  consultantDecisions: decisions,
  systemTargets: s.manifest.systemTargets,
  association: {
    itemId: s.input.selection.itemId,
    itemCode: itemSource?.label?.replace(/需求快照$/, ''),
    rowVersion: itemSource?.reference?.split('@')[1],
    workContext: s.manifest.workContext,
  },
  extraInstructions: draftInstructions(),
});
const report = {
  reportedRunId: id,
  model: model.config.modelId,
  databaseWrites: 0,
  sapCalls: 0,
  modelCalls: 0,
  attempts: [],
  reconstructedContext: true,
  recoveredDecisions: decisions.length,
};
const output = 'artifacts/fs-workspace/round2-live-model.json';
let text = '';
for (let attempt = 1; attempt <= 2; attempt++) {
  report.modelCalls++;
  const started = Date.now();
  let lastNotice = 0;
  try {
    const result = await streamText(
      model.config,
      key,
      s.prompt,
      {
        context,
        signal: AbortSignal.timeout(12 * 60 * 1000),
        onDelta: (delta) => {
          text += delta;
        },
        onProgress: (progress) => {
          if (Date.now() - lastNotice > 15000) {
            lastNotice = Date.now();
            console.log(JSON.stringify({ attempt, ...progress }));
          }
        },
      },
    );
    let validation;
    try {
      validation = validateDraft(parseDraft(text), { sources: context.manifest.sources });
    } catch {
      validation = { valid: false, errors: [{ code: 'invalid_json' }] };
    }
    report.attempts.push({ attempt, generation: result, validation, characters: text.length });
    if (validation.valid) {
      const beforeRender = performance.now();
      const rendered = renderTechnicalOutput(text);
      report.render = {
        milliseconds: performance.now() - beforeRender,
        modelCalls: 0,
        contractValid: rendered.contractValid,
        sourceHash: rendered.sourceHash,
      };
      await writeFile('artifacts/fs-workspace/round2-live-draft.json', text);
      await writeFile('artifacts/fs-workspace/round2-live-draft.md', rendered.markdown);
      report.pass = true;
      break;
    }
    if (attempt < 2) {
      context.messages.push(
        { role: 'assistant', content: text },
        {
          role: 'user',
          content:
            '仅修正以下合同错误，保留原业务范围与注册来源，返回完整JSON：' +
            JSON.stringify(validation.errors).slice(0, 24000),
        },
      );
      text = '';
    }
  } catch (e) {
    report.attempts.push({
      attempt,
      code: e.code ?? e.name,
      diagnostics: e.diagnostics,
      finishReason: e.finishReason,
      characters: text.length,
      elapsedMs: Date.now() - started,
    });
    if (e.code !== 'OUTPUT_LIMIT' || !text || attempt === 2) break;
    context.messages.push(
      { role: 'assistant', content: text },
      {
        role: 'user',
        content:
          '上次JSON因输出额度中断。严格从最后字符之后继续剩余JSON，不重复已有内容，不加围栏或解释。',
      },
    );
  } finally {
    await writeFile(output, JSON.stringify({ ...report, partialText: text }, null, 2));
  }
}
console.log(
  JSON.stringify({
    pass: report.pass ?? false,
    modelCalls: report.modelCalls,
    output,
    render: report.render,
  }),
);
if (!report.pass) process.exitCode = 1;
