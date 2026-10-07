import { spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from 'node:net';

const root = fileURLToPath(new URL('../', import.meta.url));
const runtime = join(root, '.runtime');
const stateFile = join(runtime, 'web.json');
process.chdir(root);
mkdirSync(runtime, { recursive: true });

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with code ${result.status}`);
}

async function control(action) {
  if (!existsSync(stateFile)) return false;
  const state = JSON.parse(readFileSync(stateFile, 'utf8'));
  try {
    const response = await fetch(`http://127.0.0.1:5173/__workbench/${action}`, {
      method: action === 'stop' ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${state.token}` },
      signal: AbortSignal.timeout(2000),
    });
    return response.ok && (await response.text()) === state.token;
  } catch {
    return false;
  }
}

async function assertPortFree() {
  await new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', () =>
      reject(
        new Error(
          'Port 5173 is occupied. Stop the manually started frontend or other program first.',
        ),
      ),
    );
    server.listen(5173, '127.0.0.1', () => server.close(resolve));
  });
}

async function start() {
  const alreadyRunning = await control('status');
  if (!alreadyRunning) await assertPortFree();
  run('docker', ['info', '--format', '{{.ServerVersion}}']);
  if (!existsSync(join(root, 'node_modules/vite/package.json'))) {
    if (process.platform === 'win32') run('cmd.exe', ['/d', '/c', 'npm ci']);
    else run('npm', ['ci']);
  }
  run(process.execPath, ['scripts/setup-env.mjs']);
  run(process.execPath, ['scripts/setup-sap-mcp.mjs']);
  run('docker', ['compose', 'up', '-d', '--wait', 'postgres']);
  run(process.execPath, ['--env-file=.env', 'scripts/db-migrate.mjs']);
  run(process.execPath, ['--env-file=.env', 'scripts/db-provision.mjs']);
  run(process.execPath, ['--env-file=.env', 'scripts/bootstrap.mjs']);
  if (!alreadyRunning) {
    const log = openSync(join(runtime, 'web.log'), 'a');
    const child = spawn(process.execPath, ['scripts/web-server.mjs'], {
      cwd: root,
      detached: true,
      windowsHide: true,
      stdio: ['ignore', log, log],
    });
    closeSync(log);
    child.unref();
    for (let attempt = 0; attempt < 40; attempt++) {
      if (await control('status')) break;
      if (attempt === 39)
        throw new Error(
          'Frontend did not become ready. Check .runtime/web.log; database may remain running.',
        );
      await delay(250);
    }
  }
  console.log('Started PostgreSQL and Vue: http://127.0.0.1:5173/');
}

async function stop() {
  if (await control('status')) {
    if (!(await control('stop')))
      throw new Error('Frontend refused shutdown. Check .runtime/web.log.');
    for (let attempt = 0; existsSync(stateFile) && attempt < 40; attempt++) await delay(250);
    if (existsSync(stateFile))
      throw new Error('Frontend shutdown timed out. Database has not been stopped.');
  } else {
    // Never terminate an unrelated process based on a stale PID or occupied port.
    if (existsSync(stateFile)) unlinkSync(stateFile);
    console.log(
      'No managed frontend running. Manual npm run dev sessions must be stopped separately.',
    );
  }
  if (existsSync(join(root, '.env'))) run('docker', ['compose', 'stop']);
  console.log('Stopped managed components. Database volume and data are preserved.');
}

try {
  if (process.argv[2] === 'start') await start();
  else if (process.argv[2] === 'stop') await stop();
  else throw new Error('Usage: node scripts/components.mjs start|stop');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
