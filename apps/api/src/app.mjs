import Fastify from 'fastify';
import { registerGemFsdV2 } from './gem-fsd-v2.mjs';
import { registerAbapFsdAgentRoutes } from './abap-fsd-agent/routes.mjs';
import { registerItemWorkspaceRoutes } from './item-workspace/routes.mjs';
import { registerWorkAgent } from './item-workspace/agent.mjs';
import pg from 'pg';
import { databaseConfig } from '../../../scripts/lib/database.mjs';
import { createAuth, failure } from './auth.mjs';
import { registerAdminRoutes } from './admin/routes.mjs';
import { registerDeliveryRoutes } from './delivery/routes.mjs';
import { registerTechnicalRoutes } from './technical/routes.mjs';
import { registerSapRoutes } from './sap/routes.mjs';
import { registerModelRoutes } from './models/routes.mjs';
import { registerFsWorkspaceRoutes } from './fs-workspace/routes.mjs';
import { startFsWorker } from './fs-workspace/runs/runner.mjs';

export async function createApp({
  organizationId = process.env.DEFAULT_ORGANIZATION_ID,
  origin = process.env.APP_ORIGIN ?? 'http://127.0.0.1:5173',
  modelProbe,
  agentStream,
  agentConnect,
  fsWorker = false,
} = {}) {
  if (!organizationId) throw new Error('Run npm run bootstrap before starting the app.');
  const pool = new pg.Pool({ ...databaseConfig({ runtime: true }), max: 8 });
  const auth = await createAuth(pool, organizationId);
  const app = Fastify({
    logger: false,
    bodyLimit: 8192,
    trustProxy:
      process.env.NODE_ENV === 'production' && process.env.TRUST_PROXY
        ? process.env.TRUST_PROXY.split(',')
        : false,
  });
  const secure = origin.startsWith('https://');
  const cookieName = secure ? '__Host-sapwb_session' : 'sapwb_local_session';
  const getToken = (req) =>
    (req.headers.cookie ?? '')
      .split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith(cookieName + '='))
      ?.slice(cookieName.length + 1);
  const cookie = (token, maxAge) =>
    `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
  let stopWorker;
  if (fsWorker)
    app.addHook('onReady', async () => {
      stopWorker = startFsWorker(pool, organizationId);
    });
  app.addHook('onClose', async () => {
    await stopWorker?.();
    await pool.end();
  });
  if (process.env.NODE_ENV === 'production')
    app.addHook('onResponse', async (req, reply) => {
      // Route templates only: no query strings, bodies, cookies, headers or provider responses.
      process.stdout.write(
        JSON.stringify({
          event: 'http',
          requestId: req.id,
          method: req.method,
          route: req.routeOptions.url ?? 'unmatched',
          status: reply.statusCode,
          durationMs: Math.round(reply.elapsedTime),
        }) + '\n',
      );
    });
  app.addHook('onRequest', async (req, reply) => {
    reply.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff');
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.headers.origin !== origin)
      throw failure(403, '请求来源不受信任，请从平台页面操作。');
  });
  app.setErrorHandler((error, req, reply) => {
    if (error.code === 'FS_WORKSPACE_ENABLED')
      return reply
        .code(409)
        .send({ code: error.code, message: error.message, details: [], request_id: req.id });
    if (
      req.routeOptions.url?.includes('/fs-workspace') ||
      req.routeOptions.url?.endsWith('/fs-roles')
    ) {
      const status = error.statusCode ?? 503;
      const codes = {
        400: 'INVALID_INPUT',
        401: 'UNAUTHENTICATED',
        403: 'FORBIDDEN',
        404: 'NOT_FOUND',
        409: 'VERSION_CONFLICT',
        413: 'PAYLOAD_TOO_LARGE',
        422: 'GATE_BLOCKED',
        428: 'PRECONDITION_REQUIRED',
      };
      const code = ['IDEMPOTENCY_CONFLICT', 'EVENT_CURSOR_EXPIRED'].includes(error.code)
        ? error.code
        : (codes[status] ?? 'SERVICE_UNAVAILABLE');
      return reply.code(status).send({
        code,
        message: status >= 500 ? '服务暂不可用，请稍后重试。' : error.message,
        details: [],
        request_id: req.id,
      });
    }
    if (error.code === '23505')
      return reply
        .code(409)
        .send({ message: '编码或账号已存在，或已设置企业自身客户，请检查后重试。' });
    if (['23503', '23514', '22007', '22008'].includes(error.code))
      return reply.code(400).send({ message: '数据关系、状态或日期无效，请检查输入。' });
    const status = error.statusCode ?? 503;
    reply
      .code(status)
      .send({ message: status >= 500 ? '服务暂不可用，请稍后重试。' : error.message });
  });
  async function requireSession(req, business = false) {
    const current = await auth.session(getToken(req));
    if (business && current.mustChangePassword) throw failure(403, '请先修改初始密码。');
    return current;
  }
  app.get('/api/health', async () => ({ status: 'ok' }));
  app.get('/api/health/live', async () => ({ status: 'ok' }));
  app.get('/api/health/ready', async () => {
    await pool.query('SELECT 1');
    return { status: 'ready' };
  });
  app.post('/api/login', async (req, reply) => {
    const { loginName, password } = req.body ?? {};
    const result = await auth.login(loginName, password, req.ip);
    reply.header('Set-Cookie', cookie(result.token, 8 * 60 * 60));
    return result.identity;
  });
  app.get('/api/session', async (req) => {
    const { sessionId, ...identity } = await requireSession(req);
    return identity;
  });
  app.post('/api/logout', async (req, reply) => {
    await auth.logout(getToken(req));
    reply.header('Set-Cookie', cookie('', 0));
    return { ok: true };
  });
  app.post('/api/password', async (req, reply) => {
    const current = await requireSession(req);
    await auth.changePassword(current, req.body?.currentPassword, req.body?.newPassword, req.ip);
    reply.header('Set-Cookie', cookie('', 0));
    return { ok: true };
  });
  const projectSql = `SELECT p.id,p.code,p.name,p.status,p.is_paused AS "isPaused",p.description,
    p.planned_start_date AS "plannedStartDate",p.planned_end_date AS "plannedEndDate",c.name AS "customerName"
    FROM app.project p JOIN app.project_member m ON m.project_id=p.id AND m.organization_id=p.organization_id
    JOIN app.customer c ON c.id=p.customer_id AND c.organization_id=p.organization_id
    WHERE p.organization_id=$1 AND m.user_id=$2 AND m.status='active'`;
  app.get('/api/projects', async (req) => {
    const current = await requireSession(req, true);
    return (
      await pool.query(projectSql + ' ORDER BY p.updated_at DESC,p.id DESC', [
        organizationId,
        current.user.id,
      ])
    ).rows;
  });
  app.get('/api/projects/:id', async (req) => {
    const current = await requireSession(req, true);
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) throw failure(404, '项目不存在或无权访问。');
    const { rows } = await pool.query(projectSql + ' AND p.id=$3', [
      organizationId,
      current.user.id,
      req.params.id,
    ]);
    if (!rows[0]) throw failure(404, '项目不存在或无权访问。');
    return rows[0];
  });
  registerAdminRoutes(app, pool, organizationId, requireSession);
  registerDeliveryRoutes(app, pool, organizationId, requireSession);
  registerItemWorkspaceRoutes(app, pool, organizationId, requireSession);
  registerGemFsdV2(app, pool, organizationId, requireSession, agentStream);
  registerTechnicalRoutes(app, pool, organizationId, requireSession);
  registerSapRoutes(app, pool, organizationId, requireSession);
  registerModelRoutes(app, pool, organizationId, requireSession, modelProbe);
  registerAbapFsdAgentRoutes(
    app,
    pool,
    organizationId,
    requireSession,
    agentStream,
    origin,
    agentConnect,
  );
  registerFsWorkspaceRoutes(app, pool, organizationId, requireSession);
  registerWorkAgent(app, pool, organizationId, requireSession, agentStream, origin, agentConnect);
  return app;
}
