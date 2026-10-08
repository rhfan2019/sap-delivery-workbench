import { randomUUID } from 'node:crypto';
import { validateCommand } from '@sap-delivery-workbench/contracts/fs-workspace';

// Migration is an authenticated application command, never a direct owner-DB bypass.
const [projectId, itemId, profile, legacySourceId] = process.argv.slice(2);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const body = {
  template_id: 'traditional-abap-five',
  template_version: '1.0.0',
  profile,
  legacy_source_id: legacySourceId ?? null,
};
if (
  !uuid.test(projectId ?? '') ||
  !uuid.test(itemId ?? '') ||
  !validateCommand('createFsWorkspace', body).ok
)
  throw new Error(
    'Usage: node scripts/maintenance/import-legacy-fs.mjs <project UUID> <item UUID> <profile> [legacy version UUID]',
  );
const base = new URL(process.env.FS_IMPORT_ORIGIN ?? 'http://127.0.0.1:5173');
if (
  base.protocol !== 'http:' ||
  !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) ||
  base.username ||
  base.password ||
  base.pathname !== '/' ||
  base.search ||
  base.hash
)
  throw new Error('Import CLI is restricted to a loopback development origin');
if (!process.env.FS_IMPORT_COOKIE)
  throw new Error('FS_IMPORT_COOKIE must contain a current authenticated local session cookie');
const key = process.env.FS_IMPORT_IDEMPOTENCY_KEY ?? randomUUID();
if (!uuid.test(key)) throw new Error('FS_IMPORT_IDEMPOTENCY_KEY must be a UUID');
console.log('Import command key: ' + key + ' (reuse this key after a lost response)');
const response = await fetch(
  new URL(`/api/projects/${projectId}/development-items/${itemId}/fs-workspace`, base),
  {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(30000),
    headers: {
      origin: base.origin,
      cookie: process.env.FS_IMPORT_COOKIE,
      'content-type': 'application/json',
      'idempotency-key': key,
    },
    body: JSON.stringify(body),
  },
);
if (!response.ok)
  throw new Error(
    'Import request failed with HTTP ' +
      response.status +
      '; inspect the authenticated workspace for details',
  );
const result = await response.json();
console.log('Imported workspace: ' + result.data.id);
