import { effectiveConfig } from './store.mjs';
import { open } from './crypto.mjs';
import { binding } from './resolve.mjs';
import {
  TEST_ENVIRONMENT,
  recalledCredentials,
  forgetCredentials,
  loginRequired,
} from './session-credentials.mjs';

async function projectOf(db, scope) {
  const project = (
    await db.query('SELECT * FROM app.project WHERE id=$1 AND organization_id=$2', [
      scope.projectId,
      scope.organizationId,
    ])
  ).rows[0];
  if (!project) throw Object.assign(new Error('SAP_TARGET_DENIED'), { code: 'SAP_TARGET_DENIED' });
  return project;
}

async function targetOf(db, scope, c, environment) {
  const system = (
    await db.query(
      'SELECT code,name,backend_version AS "backendVersion" FROM app.sap_system WHERE organization_id=$1 AND id=$2',
      [scope.organizationId, c.systemId],
    )
  ).rows[0];
  return {
    environment,
    systemId: c.systemId,
    systemCode: system?.code ?? '',
    systemName: system?.name ?? '',
    backendVersion: system?.backendVersion ?? '',
    client: c.client,
    username: c.username,
  };
}

const mcpEnv = (c, password) => ({
  SAP_URL: c.sapUrl,
  SAP_CLIENT: c.client,
  SAP_USER: c.username,
  SAP_PASSWORD: password,
  SAP_LANGUAGE: c.language ?? 'EN',
  SAP_REQUEST_TIMEOUT_MS: '45000',
  ...(process.env.SAP_MCP_ENTRY ? { SAP_MCP_ENTRY: process.env.SAP_MCP_ENTRY } : {}),
});

// Read-only SAP environment of a project's effective configuration (DEV by default),
// plus the facts an agent may show to the model. Never returns secrets to callers
// other than the MCP environment.
export async function resolveProjectSap(db, scope, environment = 'DEV') {
  const project = await projectOf(db, scope);
  const c = await effectiveConfig(db, scope.organizationId, project, scope.actorId, environment);
  return {
    target: await targetOf(db, scope, c, environment),
    env: mcpEnv(c, c.password ?? open(c.passwordCipher, c.credentialContext)),
  };
}

const notConfigured = () =>
  Object.assign(new Error('项目未配置可用的 QAS 系统。'), { code: 'TEST_SYSTEM_NOT_CONFIGURED' });

// Contract 3.4: the project's test system (QAS) and whether the user entered their own
// credentials in this login. Throws TEST_SYSTEM_NOT_CONFIGURED.
export async function testSystemTarget(db, scope) {
  const project = await projectOf(db, scope);
  let c;
  try {
    c = await effectiveConfig(db, scope.organizationId, project, scope.actorId, TEST_ENVIRONMENT);
  } catch {
    throw notConfigured();
  }
  if (!c.sapUrl) throw notConfigured();
  return {
    ...(await targetOf(db, scope, c, TEST_ENVIRONMENT)),
    ready: !!recalledCredentials(scope.sessionId, project.id),
  };
}

// The test system with the user's own credentials of this login. Throws
// TEST_SYSTEM_NOT_CONFIGURED or TEST_SYSTEM_LOGIN_REQUIRED.
export async function resolveTestSystem(db, scope) {
  const project = await projectOf(db, scope);
  const entry = recalledCredentials(scope.sessionId, project.id);
  let c;
  try {
    c = await effectiveConfig(db, scope.organizationId, project, scope.actorId, TEST_ENVIRONMENT, {
      username: entry?.username ?? '',
      passwordAction: entry ? 'replace' : 'keep',
      password: entry?.password,
    });
  } catch {
    throw notConfigured();
  }
  if (!c.sapUrl) throw notConfigured();
  if (!entry) throw loginRequired();
  if (binding(c) !== entry.binding) {
    forgetCredentials(scope.sessionId, project.id);
    throw loginRequired('QAS 配置已变化，请重新输入您的用户和密码。');
  }
  return { target: await targetOf(db, scope, c, TEST_ENVIRONMENT), env: mcpEnv(c, entry.password) };
}
