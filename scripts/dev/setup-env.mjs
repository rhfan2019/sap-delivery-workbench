import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const target = new URL('../../.env', import.meta.url);
try {
  const template = await readFile(new URL('../../.env.example', import.meta.url), 'utf8');
  const content = template
    .replace(/^POSTGRES_PASSWORD=$/m, 'POSTGRES_PASSWORD=' + randomBytes(32).toString('hex'))
    .replace(/^APP_DB_PASSWORD=$/m, 'APP_DB_PASSWORD=' + randomBytes(32).toString('hex'));
  const withSapKey = content.replace(
    /^SAP_CREDENTIAL_KEY=$/m,
    'SAP_CREDENTIAL_KEY=' + randomBytes(32).toString('hex'),
  );
  const withModelKey = withSapKey.replace(
    /^LLM_CREDENTIAL_KEY=$/m,
    'LLM_CREDENTIAL_KEY=' + randomBytes(32).toString('hex'),
  );
  await writeFile(target, withModelKey, { flag: 'wx', mode: 0o600 });
  console.log('Created local .env with random passwords; values are not printed.');
} catch (error) {
  if (error.code === 'EEXIST') {
    console.log('.env already exists; preserved without modification.');
  } else {
    throw error;
  }
}
