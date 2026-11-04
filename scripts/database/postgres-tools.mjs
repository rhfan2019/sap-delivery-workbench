import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Finds a PostgreSQL command line tool: PG_BIN_DIR, then PATH, then the usual install folders.
export function postgresTool(name) {
  const fromPath = spawnSync(name, ['--version']);
  if (!process.env.PG_BIN_DIR && !fromPath.error) return name;
  const directories = [
    process.env.PG_BIN_DIR,
    '/opt/homebrew/opt/postgresql@17/bin',
    '/usr/local/opt/postgresql@17/bin',
    'C:/Program Files/PostgreSQL/17/bin',
  ];
  for (const directory of directories)
    if (directory && ['', '.exe'].some((suffix) => existsSync(join(directory, name + suffix))))
      return join(directory, name);
  throw new Error(`${name} not found. Install PostgreSQL 17 or set PG_BIN_DIR.`);
}
