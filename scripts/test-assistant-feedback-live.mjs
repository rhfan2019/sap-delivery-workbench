// Explicit, read-only shadow evaluation against the model already used by the reported run.
// Never added to automatic test scripts; creates no conversations or SAP actions.
import { connectDatabase } from './lib/database.mjs';
import { getModel } from '../apps/api/src/models/store.mjs';
import { openKey } from '../apps/api/src/models/crypto.mjs';
import { streamAssistant } from '../apps/api/src/abap-fsd-agent/generation.mjs';
import { buildContext } from '../apps/api/src/abap-fsd-agent/context.mjs';
import {
  clarificationInstructions,
  parseDraft,
} from '../apps/api/src/abap-fsd-agent/specification.mjs';
import { extractConfirmedAnswers } from '../apps/api/src/abap-fsd-agent/feedback.mjs';
import { writeFile } from 'node:fs/promises';
if (process.argv[2] !== '--real-model') throw new Error('Explicit --real-model is required');
const db = await connectDatabase();
let model, key, history, answers;
try {
  await db.query('BEGIN READ ONLY');
  const {
    rows: [run],
  } = await db.query('SELECT * FROM app.fsd_agent_run WHERE id=$1', [
    'b16fc01d-39eb-416e-9c37-5b10627bae80',
  ]);
  if (!run) throw new Error('Reported run missing');
  model = await getModel(db, run.organization_id, run.snapshot.input.modelId);
  const {
    rows: [credential],
  } = await db.query(
    'SELECT secret_cipher FROM app.llm_credential WHERE organization_id=$1 AND id=$2',
    [run.organization_id, model.credentialId],
  );
  key = openKey(credential.secret_cipher, run.organization_id, model.credentialId);
  history = run.snapshot.messages;
  answers = extractConfirmedAnswers(history.slice(0, 2), history[2].content);
  await db.query('ROLLBACK');
} finally {
  await db.end();
}
const results = [];
for (const phase of ['dialogue', 'clarification']) {
  const prompt =
    phase === 'dialogue'
      ? history[2].content
      : '请按已确认的业务回答继续生成FSD，不改变原业务范围。';
  const context = buildContext({
    messages: phase === 'dialogue' ? history.slice(0, 2) : history,
    currentMessage: prompt,
    budget: 700000,
    consultantDecisions: answers,
    outputMode: phase,
    extraInstructions: phase === 'clarification' ? clarificationInstructions() : '',
  });
  context.manifest.task = phase;
  let text = '';
  const generation = await streamAssistant(
    model.config,
    key,
    prompt,
    {
      context,
      signal: AbortSignal.timeout(90000),
      onDelta: (d) => {
        text += d;
      },
    },
  );
  let pass;
  if (phase === 'dialogue')
    pass = !/^\s*(?:```json\s*)?\{/.test(text) && /下一步|生成.*FSD|已完成|起草/.test(text);
  else {
    try {
      pass = ['ready', 'clarification'].includes(parseDraft(text).kind);
    } catch {
      pass = false;
    }
  }
  results.push({ phase, pass, text, generation });
  console.log(JSON.stringify({ phase, pass, characters: text.length }));
}
await writeFile(
  'artifacts/fs-workspace/feedback-live-model.json',
  JSON.stringify({ model: model.config.modelId, sapCalls: 0, databaseWrites: 0, results }, null, 2),
);
if (results.some((r) => !r.pass)) process.exitCode = 1;
