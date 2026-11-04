import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';

// What database/init/init-database.sql is generated from. Its hash is written into the file, so a
// test can tell when a new migration or a changed grant has left the file behind.
const root = new URL('../../', import.meta.url);

export const migrationNames = () =>
  readdirSync(new URL('database/migrations/', root))
    .filter((name) => name.endsWith('.sql'))
    .map((name) => name.replace(/\.sql$/, ''))
    .sort();

export function sourceHash() {
  const hash = createHash('sha256');
  for (const name of migrationNames()) {
    hash.update(name);
    hash.update(readFileSync(new URL(`database/migrations/${name}.sql`, root)));
  }
  hash.update(readFileSync(new URL('scripts/database/provision.mjs', root)));
  return hash.digest('hex');
}
