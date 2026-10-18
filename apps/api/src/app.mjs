import Fastify from 'fastify';
import pg from 'pg';
import { databaseConfig } from './platform/database.mjs';
import { createAuth, failure, transaction } from './platform/auth.mjs';
import { registerAdminRoutes } from './modules/admin/routes.mjs';
import { registerAbapFsdAgent } from './modules/abap-fsd-agent/routes.mjs';
import { registerAbapDevAgent } from './modules/abap-dev-agent/routes.mjs';
import { registerAuditRoutes } from './modules/audit/routes.mjs';
import { registerDeliveryRoutes } from './modules/delivery/routes.mjs';
import { registerTechnicalRoutes } from './modules/technical/routes.mjs';
import { registerSapRoutes } from './modules/sap/routes.mjs';
import { registerModelRoutes } from './modules/models/routes.mjs';
import { accessContext, registerAccessRoutes, syncBuiltInRoles } from './modules/access/public.mjs';

export async function createApp({
  organizationId = process.env.DEFAULT_ORGANIZATION_ID,
  origin = process.env.APP_ORIGIN ?? 'http://127.0.0.1:5173',
  modelProbe,
  // Test seam: replaces the model, SAP and parsing collaborators of abap-fsd-agent.
  abapFsdAgent,
  abapDevAgent,
} = {}) {
  if (!organizationId) throw new Error('Run npm run bootstrap before starting the app.');
  const pool = new pg.Pool({ ...databaseConfig({ runtime: true }), max: 8 });
  const auth = await createAuth(pool, organizationId);
  // Contract 3.5: built-in roles follow the permission catalog of this release.
  await transaction(pool, (db) => syncBuiltInRoles(db, organizationId));
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
  app.addHook('onClose', async () => {
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
    if (error.code === '23505')
      return reply
        .code(409)
        .send({ message: '编码或账号已存在，或已设置企业自身客户，请检查后重试。' });
    if (['23503', '23514', '22007', '22008'].includes(error.code))
      return reply.code(400).send({ message: '数据关系、状态或日期无效，请检查输入。' });
    const status = error.statusCode ?? 503;
    if (status >= 500) {
      // Local diagnosis only; production keeps error details out of logs.
      if (process.env.API_DEBUG_ERRORS === '1') console.error(error);
      return reply.code(status).send({ message: '服务暂不可用，请稍后重试。' });
    }
    // Machine-readable reasons (ACCESS_DENIED with the missing permission, SAP_LOGIN_REQUIRED…).
    const body = { message: error.message };
    if (typeof error.code === 'string' && /^[A-Z][A-Z_]+$/.test(error.code)) body.code = error.code;
    if (error.details) body.details = error.details;
    reply.code(status).send(body);
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
  const access = accessContext(pool, organizationId, requireSession);
  app.post('/api/login', async (req, reply) => {
    const { loginName, password } = req.body ?? {};
    const result = await auth.login(loginName, password, req.ip);
    reply.header('Set-Cookie', cookie(result.token, 8 * 60 * 60));
    return {
      ...result.identity,
      permissions: await access.organization(pool, result.identity.user.id),
    };
  });
  // The identity plus the organization-level permissions the web uses for menus.
  app.get('/api/session', async (req) => {
    const { sessionId, ...identity } = await requireSession(req);
    return { ...identity, permissions: await access.organization(pool, identity.user.id) };
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
  registerAdminRoutes(app, pool, organizationId, requireSession);
  registerAccessRoutes(app, access);
  registerDeliveryRoutes(app, pool, organizationId, requireSession);
  registerAbapFsdAgent(app, pool, organizationId, requireSession, abapFsdAgent);
  registerAbapDevAgent(app, pool, organizationId, requireSession, abapDevAgent);
  registerAuditRoutes(app, pool, organizationId, requireSession);

  registerTechnicalRoutes(app, pool, organizationId, requireSession);
  registerSapRoutes(app, pool, organizationId, requireSession);
  registerModelRoutes(app, pool, organizationId, requireSession, modelProbe);
  return app;
}
