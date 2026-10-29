import { spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from 'node:net';

const root = fileURLToPath(new URL('../../', import.meta.url));
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
  // The architecture check gates commits, not the local app: a violation (such as a folder
  // another tool created) is reported but must not keep the workbench from starting.
  const architecture = spawnSync(process.execPath, ['scripts/checks/architecture.mjs'], {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (architecture.status !== 0)
    console.warn(
      'WARNING: architecture check failed (see above). Starting anyway; fix it before committing.',
    );
  run(process.execPath, ['scripts/dev/setup-env.mjs']);
  run(process.execPath, ['scripts/vendor/setup-sap-mcp.mjs']);
  run('docker', ['compose', 'up', '-d', '--wait', 'postgres']);
  run(process.execPath, ['--env-file=.env', 'scripts/database/migrate.mjs']);
  run(process.execPath, ['--env-file=.env', 'scripts/database/provision.mjs']);
  run(process.execPath, ['--env-file=.env', 'scripts/database/bootstrap.mjs']);
  console.log('Ready: PostgreSQL');
  let child, startupError;
  if (!alreadyRunning) {
    const log = openSync(join(runtime, 'web.log'), 'a');
    child = spawn(process.execPath, ['scripts/dev/web-server.mjs'], {
      cwd: root,
      detached: true,
      windowsHide: true,
      stdio: ['ignore', log, log],
    });
    closeSync(log);
    child.once('error', (error) => {
      startupError = error;
    });
    child.unref();
  }
  // The first launch after boot reads node_modules from a cold disk cache (and antivirus
  // scans every file), so loading the API can take over 30s; wait while the process lives.
  console.log('Waiting for API and Vue; the first launch after boot can take a minute...');
  const deadline = Date.now() + 180_000;
  async function waitFor(name, check) {
    let lastError;
    for (;;) {
      try {
        await check();
        console.log(`Ready: ${name}`);
        return;
      } catch (error) {
        lastError = error;
      }
      if (startupError) throw startupError;
      if (child && child.exitCode !== null)
        throw new Error(
          `API/web process exited with code ${child.exitCode}. Check .runtime/web.log.`,
        );
      if (Date.now() > deadline)
        throw new Error(
          `${name} did not become ready within 3 minutes (${lastError.message}). Check .runtime/web.log; database may remain running.`,
        );
      await delay(500);
    }
  }
  await waitFor('API and Vue processes', async () => {
    if (!(await control('status'))) throw new Error('not listening yet');
  });
  await waitFor('API (database connection)', () =>
    fetchText('http://127.0.0.1:3001/api/health/ready'),
  );
  await waitFor('Vue page and dependency bundle', async () => {
    await fetchText('http://127.0.0.1:5173/home');
    const entry = await fetchText('http://127.0.0.1:5173/src/main.ts');
    // An optimized dependency is served only after Vite has finished bundling dependencies.
    const dependency = entry.match(/["'](\/node_modules\/\.vite\/deps\/[^"'?]+)/)?.[1];
    if (dependency) await fetchText(`http://127.0.0.1:5173${dependency}`);
  });
  await waitFor('Vue to API proxy', () => fetchText('http://127.0.0.1:5173/api/health/ready'));
  console.log('Started PostgreSQL, API and Vue: http://127.0.0.1:5173/home');
}

async function fetchText(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.text();
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
  else throw new Error('Usage: node scripts/dev/components.mjs start|stop');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
