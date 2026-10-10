import { readFile } from 'node:fs/promises';
import { hash, DEFAULT_BUDGET } from './policy.mjs';
// fsd-5: the FSD is an fsd-report/1 document written in the wire format (outline, then
// parts in parallel); runs pinned to fsd-4 stop at COMPATIBILITY instead of replaying.
export const GRAPH_VERSION = 'fsd-5';
const DEPENDENCIES = Object.freeze({ langgraph: '1.4.21', postgres_saver: '1.0.6' });
export async function assetManifest(model = { mode: 'SYNTHETIC', id: 'deterministic-v1' }) {
  // One prompt for structured calls and free chat (prompt V2 §十一 covers the chat turn).
  const prompt = await readFile(new URL('./prompts/v1/system.md', import.meta.url), 'utf8');
  return {
    graph: GRAPH_VERSION,
    schema: 3,
    execution_schema: 1,
    prompt: '2',
    prompt_hash: hash(prompt),
    prompt_text: prompt,
    chat_prompt_text: prompt,
    chat_prompt_hash: hash(prompt),
    model,
    tool_contract: '1',
    node: process.version,
    dependencies: DEPENDENCIES,
    budget: DEFAULT_BUDGET,
  };
}
export function compatible(assets) {
  return (
    !!assets &&
    typeof assets.prompt_text === 'string' &&
    !!assets.dependencies &&
    assets.graph === GRAPH_VERSION &&
    assets.schema === 3 &&
    assets.execution_schema === 1 &&
    assets.prompt === '2' &&
    assets.tool_contract === '1' &&
    hash(assets.dependencies) === hash(DEPENDENCIES) &&
    hash(assets.prompt_text) === assets.prompt_hash &&
    typeof assets.chat_prompt_text === 'string' &&
    hash(assets.chat_prompt_text) === assets.chat_prompt_hash
  );
}
