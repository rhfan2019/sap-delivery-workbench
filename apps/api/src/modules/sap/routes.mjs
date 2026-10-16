import { probeSystem } from './probe.mjs';
import { randomUUID } from 'node:crypto';
import { failure } from '../../platform/auth.mjs';
import { adminContext, found, changed } from '../admin/context.mjs';
import { deliveryContext } from '../delivery/context.mjs';
import * as v from '../admin/validation.mjs';
import { sapUrl, revision } from './validation.mjs';
import { systemColumns, configView, saveRows, effectiveConfig } from './store.mjs';
import { publicConfig } from './resolve.mjs';
import { open } from './crypto.mjs';
import { connectMcp, queryTable } from '../technical/sap-mcp.mjs';
import {
  TEST_ENVIRONMENT,
  rememberCredentials,
  recalledCredentials,
  forgetCredentials,
  profileCredentials,
} from './session-credentials.mjs';

export function registerSapRoutes(app, pool, org, requireSession) {
  const admin = adminContext(pool, org, requireSession),
    delivery = deliveryContext(pool, org, requireSession);
  app.get('/api/admin/sap-systems', async (req) => {
    await admin.authorize(req);
    return (
      await pool.query(
        `SELECT ${systemColumns},c.name AS "ownerName" FROM app.sap_system s LEFT JOIN app.customer c ON c.organization_id=s.organization_id AND c.id=s.owner_customer_id WHERE s.organization_id=$1 ORDER BY s.name,s.id`,
        [org],
      )
    ).rows;
  });
  const testingSystems = new Set();
  app.post('/api/admin/sap-systems/:id/test', async (req) => {
    await admin.authorize(req);
    const id = v.uuid(req.params.id),
      b = req.body ?? {};
    const expected = v.version(b.rowVersion);
    if (typeof b.client !== 'string' || !/^\d{3}$/.test(b.client))
      throw failure(400, 'Client 必须是三位数字。');
    const username = v.text(b.username, 'SAP 用户', 100);
    if (typeof b.password !== 'string' || !b.password || b.password.length > 4096)
      throw failure(400, '请输入 SAP 密码。');
    const system = found(
      await pool.query('SELECT * FROM app.sap_system WHERE organization_id=$1 AND id=$2', [
        org,
        id,
      ]),
    );
    if (system.status !== 'active') throw failure(409, '系统已停用。');
    if (String(system.row_version) !== expected) throw failure(409, '系统已更新，请刷新后测试。');
    if (testingSystems.has(id) || testingSystems.size >= 2)
      throw failure(429, 'SAP 测试正在进行，请稍后重试。');
    testingSystems.add(id);
    try {
      const result = await probeSystem({
        SAP_MCP_ENTRY: process.env.SAP_MCP_ENTRY,
        SAP_ALLOW_HTTP: process.env.SAP_ALLOW_HTTP,
        NODE_EXTRA_CA_CERTS: process.env.NODE_EXTRA_CA_CERTS,
        SAP_REQUEST_TIMEOUT_MS: process.env.SAP_REQUEST_TIMEOUT_MS ?? '15000',
        SAP_URL: system.sap_url,
        SAP_LANGUAGE: system.language,
        SAP_CLIENT: b.client,
        SAP_USER: username,
        SAP_PASSWORD: b.password,
      });
      return await admin.write(req, 'admin.sap.system.test', 'sap_system', async (db) => {
        changed(
          await db.query(
            `UPDATE app.sap_system SET last_test_status=$4,last_test_message=$5,last_test_at=now(),backend_version=COALESCE($6,backend_version),row_version=row_version+1,updated_at=now() WHERE organization_id=$1 AND id=$2 AND row_version=$3 RETURNING id`,
            [org, id, expected, result.status, result.message, result.version],
          ),
        );
        return {
          subjectId: id,
          data: {
            ...result,
            system: found(
              await db.query(
                `SELECT ${systemColumns} FROM app.sap_system s WHERE s.organization_id=$1 AND s.id=$2`,
                [org, id],
              ),
            ),
          },
        };
      });
    } finally {
      testingSystems.delete(id);
    }
  });
  for (const method of ['post', 'patch'])
    app[method]('/api/admin/sap-systems' + (method === 'patch' ? '/:id' : ''), async (req) => {
      const b = req.body ?? {},
        id = method === 'patch' ? v.uuid(req.params.id) : randomUUID();
      const input = [
        v.code(b.code),
        v.text(b.name, '系统名称', 200),
        sapUrl(b.sapUrl),
        v.choice(b.status, ['active', 'inactive'], '系统状态', 'active'),
      ];
      const language = v.text(b.language ?? 'EN', '语言', 2).toUpperCase();
      if (!/^[A-Z]{2}$/.test(language)) throw failure(400, '语言使用两位字母。');
      return admin.write(req, 'admin.sap.system.save', 'sap_system', async (db) => {
        const owner = b.ownerCustomerId ? v.uuid(b.ownerCustomerId) : null;
        if (owner && method === 'post')
          found(
            await db.query(
              "SELECT id FROM app.customer WHERE organization_id=$1 AND id=$2 AND status='active'",
              [org, owner],
            ),
            '客户',
          );
        if (method === 'patch') {
          const existing = found(
            await db.query(
              'SELECT owner_customer_id FROM app.sap_system WHERE organization_id=$1 AND id=$2',
              [org, id],
            ),
          );
          if (existing.owner_customer_id !== owner)
            throw failure(400, '系统归属创建后不可更改；请通过临时授权开放使用。');
          changed(
            await db.query(
              `UPDATE app.sap_system SET code=$3,name=$4,last_test_status=CASE WHEN sap_url<>$5 OR language<>$7 THEN NULL ELSE last_test_status END,last_test_message=CASE WHEN sap_url<>$5 OR language<>$7 THEN NULL ELSE last_test_message END,last_test_at=CASE WHEN sap_url<>$5 OR language<>$7 THEN NULL ELSE last_test_at END,backend_version=CASE WHEN sap_url<>$5 THEN NULL ELSE backend_version END,sap_url=$5,status=$6,language=$7,row_version=row_version+1,updated_at=now() WHERE organization_id=$1 AND id=$2 AND row_version=$8 RETURNING id`,
              [org, id, ...input, language, v.version(b.rowVersion)],
            ),
          );
        } else
          await db.query(
            `INSERT INTO app.sap_system(organization_id,id,code,name,sap_url,status,language,owner_customer_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
            [org, id, ...input, language, owner],
          );
        return {
          subjectId: id,
          data: found(
            await db.query(
              `SELECT ${systemColumns} FROM app.sap_system s WHERE s.organization_id=$1 AND s.id=$2`,
              [org, id],
            ),
          ),
        };
      });
    });
  app.get('/api/admin/sap-systems/:id/grants', async (req) => {
    await admin.authorize(req);
    const id = v.uuid(req.params.id);
    return (
      await pool.query(
        `SELECT g.customer_id AS "customerId",c.name AS "customerName",g.expires_at AS "expiresAt",g.active,g.row_version AS "rowVersion" FROM app.sap_system_grant g JOIN app.customer c ON c.organization_id=g.organization_id AND c.id=g.customer_id WHERE g.organization_id=$1 AND g.system_id=$2 ORDER BY c.name`,
        [org, id],
      )
    ).rows;
  });
  app.post('/api/admin/sap-systems/:id/grants', async (req) => {
    const id = v.uuid(req.params.id),
      b = req.body ?? {},
      customer = v.uuid(b.customerId),
      version = revision(b.rowVersion);
    if (typeof b.active !== 'boolean') throw failure(400, '授权状态无效。');
    const expiry = new Date(b.expiresAt);
    if (!Number.isFinite(expiry.getTime()) || (b.active && expiry <= new Date()))
      throw failure(400, '有效授权的截至时间必须在未来。');
    return admin.write(req, 'admin.sap.grant.save', 'sap_system', async (db) => {
      const system = found(
        await db.query(
          'SELECT owner_customer_id FROM app.sap_system WHERE organization_id=$1 AND id=$2',
          [org, id],
        ),
      );
      if (!system.owner_customer_id || system.owner_customer_id === customer)
        throw failure(400, '企业自有或归属客户系统无需临时授权。');
      found(
        await db.query(
          "SELECT id FROM app.customer WHERE organization_id=$1 AND id=$2 AND (NOT $3::boolean OR status='active')",
          [org, customer, b.active],
        ),
      );
      const old = (
        await db.query(
          'SELECT row_version FROM app.sap_system_grant WHERE organization_id=$1 AND system_id=$2 AND customer_id=$3',
          [org, id, customer],
        )
      ).rows[0];
      if (String(old?.row_version ?? 0) !== version) throw failure(409, '授权已变化，请刷新。');
      await db.query(
        `INSERT INTO app.sap_system_grant(organization_id,system_id,customer_id,expires_at,active) VALUES($1,$2,$3,$4,$5) ON CONFLICT(organization_id,system_id,customer_id) DO UPDATE SET expires_at=EXCLUDED.expires_at,active=EXCLUDED.active,row_version=sap_system_grant.row_version+1,updated_at=now()`,
        [org, id, customer, expiry, b.active],
      );
      return { subjectId: id, data: { ok: true } };
    });
  });
  const project = async (db, id) =>
    found(
      await db.query('SELECT * FROM app.project WHERE organization_id=$1 AND id=$2', [
        org,
        v.uuid(id),
      ]),
      '项目',
    );
  app.get('/api/admin/projects/:id/sap', async (req) => {
    await admin.authorize(req);
    return configView(pool, org, await project(pool, req.params.id));
  });
  app.post('/api/admin/projects/:id/sap', async (req) =>
    admin.write(req, 'admin.sap.defaults.save', 'project', async (db) => {
      const p = await project(db, req.params.id);
      if (p.status === 'archived') throw failure(409, '归档项目只读。');
      return { subjectId: p.id, data: await saveRows(db, org, p, null, req.body) };
    }),
  );
  app.get('/api/projects/:projectId/sap', async (req) => {
    const { current, project } = await delivery.read(req);
    return configView(pool, org, project, current.user.id);
  });
  app.post('/api/projects/:projectId/sap', async (req) =>
    delivery.write(req, async (db, current, p) => {
      // Serialize same-user saves before reading revisions; administrator changes use the exclusive org lock.
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,1))', [
        org + ':' + p.id + ':' + current.user.id,
      ]);
      const result = await saveRows(db, org, p, current.user.id, req.body);
      await db.query(
        `INSERT INTO app.audit_event(organization_id,actor_user_id,action,outcome,subject_type,subject_id,request_id) VALUES($1,$2,'sap.personal.save','success','project',$3,$4)`,
        [org, current.user.id, p.id, randomUUID()],
      );
      return result;
    }),
  );
  app.post('/api/projects/:projectId/sap/resolve', async (req) => {
    const { current, project } = await delivery.read(req);
    return publicConfig(
      await effectiveConfig(
        pool,
        org,
        project,
        current.user.id,
        req.body?.environment,
        req.body?.temporary,
      ),
    );
  });
  // Contract 3.4: the user's own QAS credentials for this login (memory only).
  const testSystemView = async (current, p) => {
    const entry = recalledCredentials(current.sessionId, p.id);
    let c;
    try {
      c = await effectiveConfig(pool, org, p, current.user.id, TEST_ENVIRONMENT);
    } catch {
      return { environment: TEST_ENVIRONMENT, configured: false, ready: false };
    }
    const system = c.systemId
      ? (
          await pool.query(
            'SELECT code,name FROM app.sap_system WHERE organization_id=$1 AND id=$2',
            [org, c.systemId],
          )
        ).rows[0]
      : null;
    return {
      environment: TEST_ENVIRONMENT,
      configured: !!c.sapUrl,
      systemCode: system?.code ?? '',
      systemName: system?.name ?? '',
      client: c.client,
      username: entry?.username ?? c.username ?? '',
      ready: !!entry,
      // Local development only: a credentials file for this QAS can log in without typing.
      profileAvailable: !!(await profileCredentials(c)),
    };
  };
  app.get('/api/projects/:projectId/sap/test-system', async (req) => {
    const { current, project } = await delivery.read(req);
    return testSystemView(current, project);
  });
  app.post('/api/projects/:projectId/sap/test-system', async (req) => {
    const { current, project } = await delivery.read(req);
    const notConfigured = () =>
      failure(409, '项目未配置可用的 QAS 系统，请联系管理员在项目参数中配置。');
    const fromProfile = req.body?.useProfile === true;
    let username, password;
    if (fromProfile) {
      let base;
      try {
        base = await effectiveConfig(pool, org, project, current.user.id, TEST_ENVIRONMENT);
      } catch {
        throw notConfigured();
      }
      const profile = await profileCredentials(base);
      if (!profile) throw failure(409, '本机凭据文件不可用，或与项目 QAS 的地址、client 不一致。');
      ({ username, password } = profile);
    } else {
      username = v.text(req.body?.username, 'QAS 用户', 128);
      password = req.body?.password;
      if (typeof password !== 'string' || !password || password.length > 256)
        throw failure(400, '请输入 QAS 密码。');
    }
    let c;
    try {
      c = await effectiveConfig(pool, org, project, current.user.id, TEST_ENVIRONMENT, {
        username,
        password,
        passwordAction: 'replace',
      });
    } catch {
      throw notConfigured();
    }
    if (!c.sapUrl) throw notConfigured();
    const result = await probeSystem({
      SAP_MCP_ENTRY: process.env.SAP_MCP_ENTRY,
      SAP_ALLOW_HTTP: process.env.SAP_ALLOW_HTTP,
      NODE_EXTRA_CA_CERTS: process.env.NODE_EXTRA_CA_CERTS,
      SAP_REQUEST_TIMEOUT_MS: process.env.SAP_REQUEST_TIMEOUT_MS ?? '15000',
      SAP_URL: c.sapUrl,
      SAP_LANGUAGE: c.language,
      SAP_CLIENT: c.client ?? '',
      SAP_USER: username,
      SAP_PASSWORD: password,
    });
    await pool.query(
      `INSERT INTO app.audit_event(organization_id,actor_user_id,action,outcome,subject_type,subject_id,request_id,details) VALUES($1,$2,'sap.test_system.login',$3,'project',$4,$5,$6)`,
      [
        org,
        current.user.id,
        result.status === 'passed' ? 'success' : 'failure',
        project.id,
        randomUUID(),
        JSON.stringify({
          environment: TEST_ENVIRONMENT,
          systemId: c.systemId,
          username,
          source: fromProfile ? 'profile' : 'form',
        }),
      ],
    );
    if (result.status !== 'passed') throw failure(400, result.message);
    rememberCredentials(current.sessionId, project.id, c, password);
    return testSystemView(current, project);
  });
  app.delete('/api/projects/:projectId/sap/test-system', async (req) => {
    const { current, project } = await delivery.read(req);
    forgetCredentials(current.sessionId, project.id);
    return testSystemView(current, project);
  });
  let activeQueries = 0;
  app.post('/api/projects/:projectId/sap/table', async (req, reply) => {
    const current = await requireSession(req, true);
    if (activeQueries >= 2) throw failure(429, 'SAP 查询繁忙，请稍后再试。');
    activeQueries++;
    try {
      // The authorization snapshot is checked immediately before launching the isolated worker.
      const p = await delivery.access(pool, current, req.params.projectId, true);
      const c = await effectiveConfig(
        pool,
        org,
        p,
        current.user.id,
        req.body?.environment,
        req.body?.temporary,
      );
      if (!publicConfig(c).credentialReady)
        throw failure(400, 'SAP 用户或匹配密码未配置，请补充本次参数或个人项目参数。');
      const password = c.password ?? open(c.passwordCipher, c.credentialContext);
      const env = {
        SAP_MCP_ENTRY: process.env.SAP_MCP_ENTRY,
        NODE_EXTRA_CA_CERTS: process.env.NODE_EXTRA_CA_CERTS,
        SAP_ALLOW_HTTP: process.env.SAP_ALLOW_HTTP,
        SAP_REQUEST_TIMEOUT_MS: process.env.SAP_REQUEST_TIMEOUT_MS,
        SAP_URL: c.sapUrl,
        SAP_CLIENT: c.client ?? '',
        SAP_LANGUAGE: c.language,
        SAP_USER: c.username,
        SAP_PASSWORD: password,
      };
      const result = await queryTable(req.body?.tableName, { connect: () => connectMcp(env) });
      await pool.query(
        `INSERT INTO app.audit_event(organization_id,actor_user_id,action,outcome,subject_type,subject_id,request_id,details) VALUES($1,$2,'sap.table.read','success','project',$3,$4,$5)`,
        [
          org,
          current.user.id,
          p.id,
          result.requestId,
          JSON.stringify({
            environment: req.body.environment,
            systemId: c.systemId,
            tableName: result.tableName,
          }),
        ],
      );
      return { ...result, configuration: publicConfig(c) };
    } catch (error) {
      if (error.statusCode) throw error;
      return reply
        .code(error.code === 'INVALID_TABLE' ? 400 : error.code === 'TABLE_NOT_FOUND' ? 404 : 502)
        .send({
          message: /^(MCP_|TABLE_|INVALID_TABLE$)/.test(error.code ?? '')
            ? error.message
            : 'SAP 查询失败。',
          code: /^(MCP_|TABLE_|INVALID_TABLE$)/.test(error.code ?? '')
            ? error.code
            : 'SAP_QUERY_FAILED',
        });
    } finally {
      activeQueries--;
    }
  });
}
