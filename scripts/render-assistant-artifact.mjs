import { readFile, writeFile } from 'node:fs/promises';
import { renderTechnicalOutput } from '../apps/api/src/abap-fsd-agent/feedback.mjs';
const [input, output] = process.argv.slice(2);
if (!input || !output)
  throw new Error('Usage: node scripts/render-assistant-artifact.mjs input.json output.md');
const result = renderTechnicalOutput(await readFile(input, 'utf8'));
await writeFile(output, result.markdown, { encoding: 'utf8', flag: 'wx' });
console.log(
  JSON.stringify({
    output,
    sourceHash: result.sourceHash,
    rendererVersion: result.rendererVersion,
    contractValid: result.contractValid,
  }),
);
