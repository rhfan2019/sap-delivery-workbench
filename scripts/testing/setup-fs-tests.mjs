import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../../', import.meta.url);
const runtime = new URL('.runtime/', root);
await mkdir(runtime, { recursive: true });
const random = () => randomBytes(32).toString('hex');
const files = fileURLToPath(new URL('fs-test-files/', runtime)).replaceAll('\\', '/');
try {
  await writeFile(
    new URL('fs-tests.env', runtime),
    [
      'NODE_ENV=test',
      'POSTGRES_HOST=127.0.0.1',
      'POSTGRES_PORT=55439',
      'POSTGRES_DB=sap_fs_test_dev',
      'POSTGRES_USER=sap_fs_test_owner',
      'POSTGRES_PASSWORD=' + random(),
      'APP_DB_USER=sap_workbench_app',
      'APP_DB_PASSWORD=' + random(),
      'SAP_CREDENTIAL_KEY=' + random(),
      'LLM_CREDENTIAL_KEY=' + random(),
      'APP_ORIGIN=http://127.0.0.1:5173',
      'DELIVERY_FILES_DIR=' + files,
      '',
    ].join('\n'),
    { flag: 'wx', mode: 0o600 },
  );
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
}
console.log('FS test configuration ready; existing files preserved. Primary .env untouched.');
