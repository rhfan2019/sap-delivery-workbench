// Publishes an optimization proposal (Markdown) to the audit page. Usage:
//   node --env-file=.env scripts/maintenance/publish-proposal.mjs proposal.md --title "标题" [--since 2026-10-11] [--until 2026-10-13] [--source logs.json]
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { connectDatabase } from '@sap-delivery-workbench/api/platform/database';
import { publishProposal } from '@sap-delivery-workbench/api/audit-analysis';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    title: { type: 'string' },
    since: { type: 'string' },
    until: { type: 'string' },
    source: { type: 'string' },
    author: { type: 'string', default: 'Claude Code' },
  },
});
const organizationId = process.env.DEFAULT_ORGANIZATION_ID;
if (!organizationId) throw new Error('DEFAULT_ORGANIZATION_ID is required.');
if (positionals.length !== 1 || !values.title)
  throw new Error('Usage: publish-proposal.mjs proposal.md --title "标题"');
const day = (v) => (v ? new Date(v + (v.length === 10 ? 'T00:00:00' : '')).toISOString() : null);
let sources = {};
if (values.source) {
  const material = JSON.parse(await readFile(values.source, 'utf8'));
  sources = {
    file: values.source,
    runs: material.total_runs,
    comments: material.runs.reduce((n, r) => n + r.comments.length, 0),
  };
}

const db = await connectDatabase();
try {
  const id = await publishProposal(db, organizationId, {
    title: values.title,
    markdown: await readFile(positionals[0], 'utf8'),
    periodFrom: day(values.since),
    periodTo: day(values.until),
    sources,
    author: values.author,
  });
  console.log(JSON.stringify({ id }));
} finally {
  await db.end();
}
