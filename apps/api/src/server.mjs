import { createApp } from './app.mjs';
import { validateProduction } from './platform/production.mjs';
validateProduction();
const app = await createApp();
await app.listen({ host: '0.0.0.0', port: 3001 });
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  const timeout = setTimeout(() => process.exit(1), 15000).unref();
  await app.close();
  clearTimeout(timeout);
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
