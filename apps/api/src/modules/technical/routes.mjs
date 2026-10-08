import { adminContext } from '../admin/context.mjs';
import { queryTable, mcpError } from './sap-mcp.mjs';

export function registerTechnicalRoutes(app, pool, organizationId, requireSession) {
  const context = adminContext(pool, organizationId, requireSession);
  let busy = false;
  app.post('/api/admin/technical-verification/table', async (req, reply) => {
    await context.authorize(req);
    if (busy)
      return reply.code(429).send({ code: 'MCP_BUSY', message: mcpError('MCP_BUSY').message });
    busy = true;
    try {
      return await queryTable(req.body?.tableName);
    } catch (error) {
      const status =
        error.code === 'INVALID_TABLE' ? 400 : error.code === 'TABLE_NOT_FOUND' ? 404 : 502;
      return reply.code(status).send({
        status: 'error',
        code: error.code,
        message: error.message,
        requestId: error.requestId,
      });
    } finally {
      busy = false;
    }
  });
}
