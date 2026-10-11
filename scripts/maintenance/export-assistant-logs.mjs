// Exports assistant runs and reviewer comments for analysis (Claude Code reads the output
// and writes an optimization proposal). Usage:
//   node --env-file=.env scripts/maintenance/export-assistant-logs.mjs [--since 2026-10-11] [--until 2026-10-13] [--out dir]
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { connectDatabase } from '@sap-delivery-workbench/api/platform/database';
import { analysisMarkdown, buildAnalysis } from '@sap-delivery-workbench/api/audit-analysis';

const { values } = parseArgs({
  options: {
    since: { type: 'string' },
    until: { type: 'string' },
    out: { type: 'string', default: '.runtime/artifacts/assistant-logs' },
  },
});
const organizationId = process.env.DEFAULT_ORGANIZATION_ID;
if (!organizationId) throw new Error('DEFAULT_ORGANIZATION_ID is required.');
const day = (v) =>
  v ? new Date(v + (v.length === 10 ? 'T00:00:00' : '')).toISOString() : undefined;
const filters = { from: day(values.since), to: day(values.until) };

const db = await connectDatabase();
try {
  const material = await buildAnalysis(db, organizationId, filters, { detail: true });
  const folder = resolve(values.out);
  await mkdir(folder, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const json = join(folder, `assistant-logs-${stamp}.json`);
  const md = join(folder, `assistant-logs-${stamp}.md`);
  await writeFile(json, JSON.stringify(material, null, 2));
  await writeFile(md, analysisMarkdown(material));
  console.log(
    JSON.stringify({ runs: material.total_runs, included: material.included_runs, json, md }),
  );
} finally {
  await db.end();
}
