import { randomUUID } from 'node:crypto';
import { failure } from '../../platform/auth.mjs';
import { accessContext, createAccess, deniedError } from '../access/public.mjs';
import { uuid, version } from '../admin/validation.mjs';
import { probeSystem } from './probe.mjs';
import { systemInput, credentialInput, policyInput } from './validation.mjs';
import { projectSystems, systemById, systemColumns } from './systems.mjs';
import {
  credentialFor,
  credentialStatus,
  deleteCredential,
  forgetForSession,
  forgetUser,
  maySave,
  policyOf,
  profileCredentials,
  rememberForSession,
  saveCredential,
} from './credentials.mjs';

// Contract 3.4: project SAP systems, personal credentials and the credential policy
// (docs/specs/project-access-admin.md section 3).
export function registerSapRoutes(app, pool, org, requireSession) {
  const ctx = accessContext(pool, org, requireSession);
  const { readProject, writeProject, authorize, write } = ctx;
  const access = createAccess(pool, org);
  const base = '/api/projects/:projectId/sap-systems';

  const personTypeOf = async (db, userId) =>
    (await db.query('SELECT person_type FROM app.app_user WHERE id=$1', [userId])).rows[0]
      ?.person_type ?? 'employee';
  // Systems of a project with the signed-in user's own credential state for each.
  async function view(db, current, grant) {
    const policy = await policyOf(db, org);
    const systems = await projectSystems(db, org, grant.project.id);
    for (const s of systems) {
      s.credential = await credentialStatus(db, org, current, s, policy);
      s.canRead = grant.has(`sap.${s.purpose}:read`);
    }
    return {
      projectId: grant.project.id,
      readOnly: grant.project.status === 'archived',
      canManage: grant.has('project.sap:manage'),
      canSave: maySave(policy, await personTypeOf(db, current.user.id)),
      policy: { maxDays: policy.maxDays, idleDays: policy.idleDays },
      profileLogin: process.env.NODE_ENV !== 'production' && !!process.env.SAP_MCP_PROFILE_FILE,
      systems,
    };
  }
  app.get(base, async (req) => {
    const { current, grant } = await readProject(req, 'project.sap:view');
    return view(pool, current, grant);
  });

  // The first active system of a purpose becomes its default; a switched-off default steps down.
  async function settleDefaults(db, projectId) {
    await db.query(
      `UPDATE app.project_sap_system SET is_default=false,row_version=row_version+1,updated_at=now()
      WHERE organization_id=$1 AND project_id=$2 AND is_default AND status<>'active'`,
      [org, projectId],
    );
    for (const purpose of ['development', 'test'])
      await db.query(
        `UPDATE app.project_sap_system SET is_default=true,row_version=row_version+1,updated_at=now()
        WHERE id=(SELECT id FROM app.project_sap_system WHERE organization_id=$1 AND project_id=$2 AND purpose=$3 AND status='active'
          ORDER BY created_at LIMIT 1)
        AND NOT EXISTS(SELECT 1 FROM app.project_sap_system WHERE organization_id=$1 AND project_id=$2 AND purpose=$3 AND is_default)`,
        [org, projectId, purpose],
      );
  }
  const duplicate = (error) => {
    if (error?.code === '23505')
      throw failure(409, '本项目已登记相同用途、ADT 地址与 Client 的系统。');
    throw error;
  };
  app.post(base, async (req, reply) => {
    const input = systemInput(req.body);
    const result = await writeProject(
      req,
      'project.sap:manage',
      'sap.system.create',
      'sap_system',
      async (db, current, grant) => {
        const { rows } = await db
          .query(
            `INSERT INTO app.project_sap_system(organization_id,project_id,name,purpose,sid,sap_url,client,language,description,status,created_by)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
            [
              org,
              grant.project.id,
              input.name,
              input.purpose,
              input.sid,
              input.sapUrl,
              input.client,
              input.language,
              input.description,
              input.status,
              current.user.id,
            ],
          )
          .catch(duplicate);
        await settleDefaults(db, grant.project.id);
        return {
          subjectId: rows[0].id,
          data: await view(db, current, grant),
          details: { sid: input.sid, client: input.client },
        };
      },
    );
    reply.code(201);
    return result;
  });
  app.patch(base + '/:systemId', async (req) => {
    const id = uuid(req.params.systemId),
      input = systemInput(req.body),
      revision = version(req.body?.rowVersion);
    return writeProject(
      req,
      'project.sap:manage',
      'sap.system.update',
      'sap_system',
      async (db, current, grant) => {
        const before = await systemById(db, org, grant.project.id, id);
        if (before.purpose !== input.purpose)
          throw failure(400, '系统用途登记后不能更改；如需更改，请新建系统并停用此系统。');
        const { rowCount } = await db
          .query(
            `UPDATE app.project_sap_system SET name=$4,sid=$5,sap_url=$6::varchar,client=$7::varchar,language=$8,description=$9,status=$10::varchar,
            last_test_status=CASE WHEN sap_url<>$6::varchar OR client<>$7::varchar THEN NULL ELSE last_test_status END,
            last_test_message=CASE WHEN sap_url<>$6::varchar OR client<>$7::varchar THEN NULL ELSE last_test_message END,
            last_test_at=CASE WHEN sap_url<>$6::varchar OR client<>$7::varchar THEN NULL ELSE last_test_at END,
            backend_version=CASE WHEN sap_url<>$6::varchar THEN NULL ELSE backend_version END,
            is_default=is_default AND $10::varchar='active',row_version=row_version+1,updated_at=now()
          WHERE organization_id=$1 AND project_id=$2 AND id=$3 AND row_version=$11`,
            [
              org,
              grant.project.id,
              id,
              input.name,
              input.sid,
              input.sapUrl,
              input.client,
              input.language,
              input.description,
              input.status,
              revision,
            ],
          )
          .catch(duplicate);
        if (!rowCount) throw failure(409, 'SAP 系统已被其他操作更新，请刷新后重试。');
        await settleDefaults(db, grant.project.id);
        return {
          subjectId: id,
          data: await view(db, current, grant),
          details: { sid: input.sid, client: input.client, status: input.status },
        };
      },
    );
  });
  app.post(base + '/:systemId/default', async (req) => {
    const id = uuid(req.params.systemId);
    return writeProject(
      req,
      'project.sap:manage',
      'sap.system.default',
      'sap_system',
      async (db, current, grant) => {
        const system = await systemById(db, org, grant.project.id, id);
        if (system.status !== 'active') throw failure(409, '停用的系统不能设为默认。');
        await db.query(
          `UPDATE app.project_sap_system SET is_default=false,row_version=row_version+1,updated_at=now()
        WHERE organization_id=$1 AND project_id=$2 AND purpose=$3 AND is_default AND id<>$4`,
          [org, grant.project.id, system.purpose, id],
        );
        await db.query(
          'UPDATE app.project_sap_system SET is_default=true,row_version=row_version+1,updated_at=now() WHERE id=$1 AND NOT is_default',
          [id],
        );
        return { subjectId: id, data: await view(db, current, grant) };
      },
    );
  });
  app.delete(base + '/:systemId', async (req) => {
    const id = uuid(req.params.systemId),
      revision = version(req.body?.rowVersion);
    return writeProject(
      req,
      'project.sap:manage',
      'sap.system.delete',
      'sap_system',
      async (db, current, grant) => {
        const system = await systemById(db, org, grant.project.id, id);
        const { rowCount } = await db.query(
          'DELETE FROM app.project_sap_system WHERE organization_id=$1 AND project_id=$2 AND id=$3 AND row_version=$4',
          [org, grant.project.id, id, revision],
        );
        if (!rowCount) throw failure(409, 'SAP 系统已被其他操作更新，请刷新后重试。');
        await settleDefaults(db, grant.project.id);
        return {
          subjectId: id,
          data: await view(db, current, grant),
          details: { sid: system.sid, client: system.client },
        };
      },
    );
  });
  // Copies the systems of another project of the same customer (section 3.2).
  app.post(base + '/copy', async (req) => {
    const source = uuid(req.body?.sourceProjectId);
    return writeProject(
      req,
      'project.sap:manage',
      'sap.system.copy',
      'project',
      async (db, current, grant) => {
        const from = await access.project(db, current.user.id, source);
        if (!from?.has('project.sap:view')) throw failure(404, '来源项目不存在或无权访问。');
        if (from.project.customer_id !== grant.project.customer_id)
          throw failure(400, '只能从同一客户的其他项目复制。');
        const { rowCount } = await db.query(
          `INSERT INTO app.project_sap_system(organization_id,project_id,name,purpose,sid,sap_url,client,language,description,status,created_by)
        SELECT organization_id,$3,name,purpose,sid,sap_url,client,language,description,status,$4
        FROM app.project_sap_system s WHERE s.organization_id=$1 AND s.project_id=$2
        AND NOT EXISTS(SELECT 1 FROM app.project_sap_system t WHERE t.project_id=$3 AND t.purpose=s.purpose AND t.sap_url=s.sap_url AND t.client=s.client)`,
          [org, source, grant.project.id, current.user.id],
        );
        await settleDefaults(db, grant.project.id);
        return {
          subjectId: grant.project.id,
          data: { ...(await view(db, current, grant)), copied: rowCount },
          details: { source, copied: rowCount },
        };
      },
    );
  });

  // Logs in with the person's own SAP user once; only a successful login is kept (section 3.3).
  const probing = new Set();
  async function login(system, username, password) {
    const key = system.id + ':' + username;
    if (probing.has(key) || probing.size >= 4)
      throw failure(429, 'SAP 登录验证正在进行，请稍后重试。');
    probing.add(key);
    try {
      return await probeSystem({
        SAP_MCP_ENTRY: process.env.SAP_MCP_ENTRY,
        SAP_ALLOW_HTTP: process.env.SAP_ALLOW_HTTP,
        NODE_EXTRA_CA_CERTS: process.env.NODE_EXTRA_CA_CERTS,
        SAP_REQUEST_TIMEOUT_MS: process.env.SAP_REQUEST_TIMEOUT_MS ?? '15000',
        SAP_URL: system.sapUrl,
        SAP_LANGUAGE: system.language,
        SAP_CLIENT: system.client,
        SAP_USER: username,
        SAP_PASSWORD: password,
      });
    } finally {
      probing.delete(key);
    }
  }
  const recordTest = (db, system, result) =>
    db.query(
      `UPDATE app.project_sap_system SET last_test_status=$2,last_test_message=$3,last_test_at=now(),
      backend_version=COALESCE($4,backend_version) WHERE id=$1`,
      [system.id, result.status, result.message, result.version],
    );
  const loginAudit = (db, current, system, result, source) =>
    db.query(
      `INSERT INTO app.audit_event(organization_id,actor_user_id,action,outcome,subject_type,subject_id,request_id,details)
      VALUES($1,$2,'sap.credential.login',$3,'sap_system',$4,$5,$6)`,
      [
        org,
        current.user.id,
        result.status === 'passed' ? 'success' : 'failure',
        system.id,
        randomUUID(),
        JSON.stringify({ projectId: system.projectId, code: result.code, source }),
      ],
    );
  async function readable(req) {
    const { current, grant } = await readProject(req, 'project:view');
    const system = await systemById(pool, org, grant.project.id, uuid(req.params.systemId));
    if (!grant.has(`sap.${system.purpose}:read`)) throw deniedError(`sap.${system.purpose}:read`);
    if (system.status !== 'active') throw failure(409, '系统已停用。');
    return { current, grant, system };
  }
  app.put(base + '/:systemId/credential', async (req) => {
    const { current, grant, system } = await readable(req);
    const input = credentialInput(req.body);
    const policy = await policyOf(pool, org);
    if (input.mode === 'saved' && !maySave(policy, await personTypeOf(pool, current.user.id)))
      throw failure(403, '企业安全策略不允许您保存 SAP 密码，请选择“本次登录有效”。');
    const result = await login(system, input.username, input.password);
    await loginAudit(pool, current, system, result, 'form');
    await recordTest(pool, system, result);
    if (result.status !== 'passed')
      throw Object.assign(failure(400, `SAP 登录失败：${result.message}`), {
        code: 'SAP_LOGIN_FAILED',
      });
    forgetForSession(current.sessionId, system.id);
    if (input.mode === 'saved')
      await saveCredential(pool, org, current.user.id, system, input, policy);
    else {
      await deleteCredential(pool, org, current.user.id, system);
      rememberForSession(
        current.sessionId,
        current.user.id,
        system,
        input.username,
        input.password,
      );
    }
    return view(pool, current, grant);
  });
  // Local development only (contract 3.4): log in with the credentials file for this login.
  app.post(base + '/:systemId/credential/profile', async (req) => {
    const { current, grant, system } = await readable(req);
    const profile = await profileCredentials(system);
    if (!profile) throw failure(409, '本机凭据文件不可用，或与该系统的地址、Client 不一致。');
    const result = await login(system, profile.username, profile.password);
    await loginAudit(pool, current, system, result, 'profile');
    await recordTest(pool, system, result);
    if (result.status !== 'passed') throw failure(400, `SAP 登录失败：${result.message}`);
    rememberForSession(
      current.sessionId,
      current.user.id,
      system,
      profile.username,
      profile.password,
    );
    return view(pool, current, grant);
  });
  app.delete(base + '/:systemId/credential', async (req) => {
    const { current, grant } = await readProject(req, 'project:view');
    const system = await systemById(pool, org, grant.project.id, uuid(req.params.systemId));
    forgetForSession(current.sessionId, system.id);
    await deleteCredential(pool, org, current.user.id, system);
    return view(pool, current, grant);
  });
  // Tests the connection with the person's own credential (any saved or this-login one), or
  // with a user and password given only for this test.
  app.post(base + '/:systemId/test', async (req) => {
    const { current, grant, system } = await readable(req);
    let username = req.body?.username,
      password = req.body?.password;
    if (!username) {
      const credential = await credentialFor(
        pool,
        org,
        { userId: current.user.id, sessionId: current.sessionId },
        system,
        await policyOf(pool, org),
      );
      if (!credential)
        throw Object.assign(failure(409, `请先登录 ${system.name}。`), {
          code: 'SAP_LOGIN_REQUIRED',
        });
      ({ username, password } = credential);
      const result = await login(system, username, password);
      if (result.status !== 'passed' && result.code === 'AUTH_FAILED') await credential.rejected();
      await recordTest(pool, system, result);
      return { ...result, system: await systemById(pool, org, grant.project.id, system.id) };
    }
    const input = credentialInput({ username, password, mode: 'session' });
    const result = await login(system, input.username, input.password);
    await loginAudit(pool, current, system, result, 'test');
    await recordTest(pool, system, result);
    return { ...result, system: await systemById(pool, org, grant.project.id, system.id) };
  });

  // The signed-in user's credentials in every project they can enter (the personal page).
  app.get('/api/sap-credentials', async (req) => {
    const current = await requireSession(req, true);
    const policy = await policyOf(pool, org);
    const grants = await access.projects(pool, current.user.id);
    const result = [];
    for (const grant of grants) {
      const systems = (await projectSystems(pool, org, grant.project.id)).filter(
        (s) => s.status === 'active' && grant.has(`sap.${s.purpose}:read`),
      );
      for (const s of systems)
        result.push({
          projectId: grant.project.id,
          projectCode: grant.project.code,
          projectName: grant.project.name,
          system: s,
          credential: await credentialStatus(pool, org, current, s, policy),
        });
    }
    return {
      canSave: maySave(policy, await personTypeOf(pool, current.user.id)),
      policy: { maxDays: policy.maxDays, idleDays: policy.idleDays },
      items: result,
    };
  });

  // Organization security policy and forced removal (section 3.4).
  app.get('/api/admin/sap-credential-policy', async (req) => {
    await authorize(req, 'org.security:manage');
    return policyOf(pool, org);
  });
  app.put('/api/admin/sap-credential-policy', async (req) => {
    const input = policyInput(req.body);
    const revision = String(req.body?.rowVersion ?? '0');
    return write(
      req,
      'org.security:manage',
      'sap.credential_policy.update',
      'organization',
      async (db, current) => {
        const prior = await policyOf(db, org);
        if (String(prior.rowVersion) !== revision)
          throw failure(409, '策略已被其他操作更新，请刷新后重试。');
        await db.query(
          `INSERT INTO app.sap_credential_policy(organization_id,allow_save,max_days,idle_days,subcontractor_save,updated_by)
        VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(organization_id) DO UPDATE SET allow_save=$2,max_days=$3,idle_days=$4,
        subcontractor_save=$5,updated_by=$6,updated_at=now(),row_version=app.sap_credential_policy.row_version+1`,
          [
            org,
            input.allowSave,
            input.maxDays,
            input.idleDays,
            input.subcontractorSave,
            current.user.id,
          ],
        );
        // Saved credentials follow a stricter policy at once.
        if (!input.allowSave)
          await db.query('DELETE FROM app.sap_user_credential WHERE organization_id=$1', [org]);
        else {
          await db.query(
            `UPDATE app.sap_user_credential SET expires_at=LEAST(expires_at,saved_at+make_interval(days=>$2)) WHERE organization_id=$1`,
            [org, input.maxDays],
          );
          if (!input.subcontractorSave)
            await db.query(
              `DELETE FROM app.sap_user_credential c USING app.app_user u WHERE c.organization_id=$1 AND u.id=c.user_id AND u.person_type<>'employee'`,
              [org],
            );
        }
        return { subjectId: org, data: await policyOf(db, org), details: input };
      },
    );
  });
  app.get('/api/admin/sap-credentials', async (req) => {
    await authorize(req, 'org.security:manage');
    return (
      await pool.query(
        `SELECT c.user_id AS "userId",u.display_name AS "displayName",u.login_name AS "loginName",
          p.code AS "projectCode",p.name AS "projectName",s.name AS "systemName",s.sid,s.client,c.sap_username AS "sapUsername",
          c.saved_at AS "savedAt",c.expires_at AS "expiresAt",c.last_used_at AS "lastUsedAt"
        FROM app.sap_user_credential c JOIN app.app_user u ON u.id=c.user_id JOIN app.project p ON p.id=c.project_id
        JOIN app.project_sap_system s ON s.id=c.system_id WHERE c.organization_id=$1 ORDER BY u.display_name,p.name,s.name`,
        [org],
      )
    ).rows;
  });
  app.delete('/api/admin/users/:id/sap-credentials', async (req) => {
    const id = uuid(req.params.id);
    return write(req, 'org.security:manage', 'sap.credential.purge', 'user', async (db) => {
      const { rowCount } = await db.query(
        'DELETE FROM app.sap_user_credential WHERE organization_id=$1 AND user_id=$2',
        [org, id],
      );
      forgetUser(id);
      return { subjectId: id, data: { removed: rowCount }, details: { removed: rowCount } };
    });
  });
  // Every system registered in any project, read-only (section 3.2).
  app.get('/api/admin/sap-systems', async (req) => {
    await authorize(req, 'sap.directory:view');
    return (
      await pool.query(
        `SELECT ${systemColumns},p.code AS "projectCode",p.name AS "projectName",p.status AS "projectStatus",c.name AS "customerName"
        FROM app.project_sap_system s JOIN app.project p ON p.id=s.project_id JOIN app.customer c ON c.id=p.customer_id
        WHERE s.organization_id=$1 ORDER BY c.name,p.name,s.purpose,s.name`,
        [org],
      )
    ).rows;
  });
}
