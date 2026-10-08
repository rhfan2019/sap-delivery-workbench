import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { connectMcp, queryTable, decodeResult } from '@sap-delivery-workbench/api/sap-mcp';

const output = resolve(process.argv[2] ?? '.runtime/sap-mcp-evidence');
await mkdir(output, { recursive: true });
const events = [];
const connect = () =>
  connectMcp(process.env, {
    onProtocol: (direction, message) =>
      events.push({ at: new Date().toISOString(), direction, message }),
  });
const result = await queryTable('T000', { connect });
await writeFile(join(output, '01-table-T000.json'), JSON.stringify(result, null, 2));
let c;
try {
  c = await connect();
  const health = await decodeHealth(await c.call('healthcheck', {}));
  await writeFile(join(output, '02-healthcheck.json'), JSON.stringify(health, null, 2));
  const uriProbe = await decodeResult(
    await c.call('ddicElement', { path: '/sap/bc/adt/ddic/tables/t000' }),
    c.call,
  );
  await writeFile(join(output, '03-uri-path-probe.json'), JSON.stringify(uriProbe, null, 2));
} finally {
  await c?.close();
}
try {
  await queryTable('Z_MCP_VERIFY_ABSENT_9F72', { connect });
  throw new Error('Expected absent object');
} catch (error) {
  if (error.code !== 'TABLE_NOT_FOUND') throw error;
  await writeFile(
    join(output, '04-absent-table.json'),
    JSON.stringify(
      { code: error.code, message: error.message, requestId: error.requestId },
      null,
      2,
    ),
  );
}
await writeFile(
  join(output, '05-protocol.jsonl'),
  events.map((event) => JSON.stringify(event)).join('\n') + '\n',
);
const root = dirname(
  dirname(
    process.env.SAP_MCP_ENTRY ||
      fileURLToPath(new URL('../../vendor/abap-adt/dist/index.js', import.meta.url)),
  ),
);
const files = [
  'package.json',
  'README.md',
  'UPSTREAM.md',
  'package-lock.json',
  'LICENSE',
  'src/index.ts',
  'src/server.ts',
  'src/lib/http.ts',
  'src/lib/results.ts',
  'src/handlers/DdicHandlers.ts',
  'dist/index.js',
  'dist/server.js',
  'dist/lib/http.js',
  'dist/lib/results.js',
  'dist/handlers/DdicHandlers.js',
];
await mkdir(join(output, 'source'), { recursive: true });
const manifest = [];
for (const file of files) {
  let content;
  try {
    content = await readFile(join(root, file));
  } catch (error) {
    if (error.code === 'ENOENT') continue;
    throw error;
  }
  const saved = file.replaceAll('/', '__');
  await writeFile(join(output, 'source', saved), content);
  manifest.push({
    source: join(root, file),
    snapshot: 'source/' + saved,
    sha256: createHash('sha256').update(content).digest('hex'),
  });
}
await writeFile(
  join(output, '06-source-manifest.json'),
  JSON.stringify({ capturedAt: new Date().toISOString(), files: manifest }, null, 2),
);
console.log(
  JSON.stringify(
    {
      status: result.status,
      table: result.tableName,
      fields: result.fieldCount,
      toolCount: result.source.discoveredToolCount,
      protocolEvents: events.length,
      evidenceDirectory: output,
    },
    null,
    2,
  ),
);
async function decodeHealth(result) {
  return JSON.parse(result.content[0].text);
}
