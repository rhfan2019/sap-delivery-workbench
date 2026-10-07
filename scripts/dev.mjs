import { loadEnvFile } from 'node:process';
import { createServer } from 'vite';
import { createApp } from '../apps/api/src/app.mjs';
import { fileURLToPath } from 'node:url';
loadEnvFile('.env');
const api = await createApp({fsWorker:true});
await api.listen({ host: '127.0.0.1', port: 3001 });
let web;
try {
  web = await createServer({ root: fileURLToPath(new URL('../apps/web/', import.meta.url)) });
  await web.listen();
} catch (error) {
  await web?.close();
  await api.close();
  throw error;
}
console.log('Workbench: http://127.0.0.1:5173');
async function stop() {
  await web.close();
  await api.close();
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
