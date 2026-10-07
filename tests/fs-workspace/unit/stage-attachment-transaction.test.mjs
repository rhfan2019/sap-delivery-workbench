import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import { registerAgentAttachments } from '../../../apps/api/src/abap-fsd-agent/attachments.mjs';
test('attachment reauthorization uses its transaction connection instead of waiting for its own row lock', async () => {
  let inTransaction = false;
  const query = async (sql) => ({
    rows: sql.includes('count(*)')
      ? [{ n: 0, bytes: 0 }]
      : sql.includes('SELECT * FROM app.fsd_agent_session')
        ? [{ selection: {} }]
        : [{ id: randomUUID(), state: 'ready', extraction: { warnings: [] } }],
  });
  const pool = { query },
    db = { query };
  const c = {
    authorize: async (_req, connection = pool) => {
      if (inTransaction)
        assert.equal(connection, db, 'nested authorization must share locked transaction');
      return { user: { id: randomUUID() } };
    },
    write: async (_req, _a, _s, op) => {
      inTransaction = true;
      try {
        return (await op(db)).data;
      } finally {
        inTransaction = false;
      }
    },
  };
  const app = Fastify();
  registerAgentAttachments(app, { c, pool, org: randomUUID(), delivery: {} });
  try {
    const boundary = 'stage-test-boundary';
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/abap-fsd-agent/conversations/' + randomUUID() + '/attachments',
      headers: { 'content-type': 'multipart/form-data; boundary=' + boundary },
      payload: `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="requirement.txt"\r\nContent-Type: text/plain\r\n\r\nsynthetic requirement\r\n--${boundary}--\r\n`,
    });
    assert.equal(response.statusCode, 200, response.body);
  } finally {
    await app.close();
  }
});
