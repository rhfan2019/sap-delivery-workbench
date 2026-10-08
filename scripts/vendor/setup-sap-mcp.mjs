import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const directory = fileURLToPath(new URL('../../vendor/abap-adt/', import.meta.url));
if (
  !existsSync(
    new URL(
      '../../vendor/abap-adt/node_modules/@modelcontextprotocol/server/package.json',
      import.meta.url,
    ),
  )
) {
  const command = process.platform === 'win32' ? 'cmd.exe' : 'npm';
  const args =
    process.platform === 'win32'
      ? ['/d', '/c', 'npm ci --omit=dev --ignore-scripts']
      : ['ci', '--omit=dev', '--ignore-scripts'];
  const result = spawnSync(command, args, { cwd: directory, stdio: 'inherit', windowsHide: true });
  if (result.error || result.status !== 0)
    throw new Error('SAP MCP dependencies could not be installed.');
}
console.log('Bundled SAP MCP runtime ready.');
