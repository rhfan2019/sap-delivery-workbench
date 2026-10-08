import { createServer } from 'vite';
import { randomBytes } from 'node:crypto';
import { writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';
import { createApp } from '@sap-delivery-workbench/api';

loadEnvFile(new URL('../../.env', import.meta.url));
const api = await createApp({fsWorker:true});
await api.listen({ host: '127.0.0.1', port: 3001 });

const stateFile = new URL('../../.runtime/web.json', import.meta.url);
const token = randomBytes(32).toString('hex');
let stopping = false;
function controlMiddleware(request, response, next) {
  if (!request.url?.startsWith('/__workbench/')) return next();
  if (request.headers.authorization !== `Bearer ${token}`) {
    response.statusCode = 403;
    return response.end();
  }
  if (request.url === '/__workbench/status' && request.method === 'GET') return response.end(token);
  if (request.url === '/__workbench/stop' && request.method === 'POST' && !stopping) {
    stopping = true;
    response.end(token, () => {
      void server.close().then(async () => {
        await api.close();
        unlinkSync(stateFile);
        process.exit(0);
      });
    });
    return;
  }
  response.statusCode = 404;
  response.end();
}
const server = await createServer({
  root: fileURLToPath(new URL('../../apps/web/', import.meta.url)),
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  plugins: [
    {
      name: 'workbench-local-control',
      configureServer(viteServer) {
        viteServer.middlewares.use(controlMiddleware);
      },
    },
  ],
});
await server.listen();
writeFileSync(stateFile, JSON.stringify({ token }), { mode: 0o600 });
console.log('Managed Vue development server listening on http://127.0.0.1:5173/');
