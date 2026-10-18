import { createAccess } from '../access/public.mjs';
import { credentialFor, credentialStatus, policyOf } from './credentials.mjs';
import { selectSystem, environmentOf, purposeLabel } from './systems.mjs';

// Contract 3.4: the project SAP system an agent turn uses, with the actor's own credential.
// A selector is { systemId } (the user's pick for this message) or { purpose } ('development'
// or 'test'); the labels 'DEV' and 'QAS' are accepted for the purposes.

const coded = (code, message, details) => Object.assign(new Error(message), { code, details });
function selectorOf(value) {
  if (value === 'DEV') return { purpose: 'development' };
  if (value === 'QAS') return { purpose: 'test' };
  return { systemId: value?.systemId ?? null, purpose: value?.purpose ?? 'development' };
}
const targetOf = (system, username) => ({
  environment: environmentOf(system),
  purpose: system.purpose,
  systemId: system.id,
  systemCode: system.sid,
  systemName: system.name,
  backendVersion: system.backendVersion ?? '',
  client: system.client,
  username,
});
const mcpEnv = (system, credential) => ({
  SAP_URL: system.sapUrl,
  SAP_CLIENT: system.client,
  SAP_USER: credential.username,
  SAP_PASSWORD: credential.password,
  SAP_LANGUAGE: system.language ?? 'EN',
  SAP_REQUEST_TIMEOUT_MS: '45000',
  ...(process.env.SAP_MCP_ENTRY ? { SAP_MCP_ENTRY: process.env.SAP_MCP_ENTRY } : {}),
});
const loginMessage = (system) =>
  `请先登录 ${system.name}（${system.sid} client ${system.client}）：在输入框的系统选择中登录，或在“设置 → 我的 SAP 凭据”中登录。`;

async function system(db, scope, selector) {
  const sel = selectorOf(selector);
  const found = await selectSystem(db, scope.organizationId, scope.projectId, {
    ...sel,
    itemId: scope.itemId,
  });
  return { found, purpose: found?.purpose ?? sel.purpose };
}
async function permitted(db, scope, code) {
  const grant = await createAccess(null, scope.organizationId).project(
    db,
    scope.actorId,
    scope.projectId,
  );
  return !!grant?.has(code);
}

// Read-only SAP environment for an agent turn. Throws SAP_NOT_CONFIGURED, ACCESS_DENIED or
// SAP_LOGIN_REQUIRED. `rejected()` discards the credential when SAP refuses it.
export async function resolveProjectSap(db, scope, selector = 'DEV') {
  const { found, purpose } = await system(db, scope, selector);
  if (!found)
    throw coded(
      'SAP_NOT_CONFIGURED',
      `项目没有可用的${purposeLabel(purpose)}，请项目经理在“设置 → 项目 → SAP 系统”中登记。`,
    );
  if (!(await permitted(db, scope, `sap.${found.purpose}:read`)))
    throw coded('ACCESS_DENIED', `您没有读取${purposeLabel(found.purpose)}的权限。`);
  const credential = await credentialFor(
    db,
    scope.organizationId,
    { userId: scope.actorId, sessionId: scope.sessionId },
    found,
    await policyOf(db, scope.organizationId),
  );
  if (!credential) throw coded('SAP_LOGIN_REQUIRED', loginMessage(found), { systemId: found.id });
  return {
    target: targetOf(found, credential.username),
    env: mcpEnv(found, credential),
    rejected: credential.rejected,
  };
}

const testNotConfigured = () =>
  coded(
    'TEST_SYSTEM_NOT_CONFIGURED',
    '项目没有可用的测试系统，请项目经理在“设置 → 项目 → SAP 系统”中登记。',
  );

// The project's test system and whether the actor can log in to it now (for the agent's
// background facts). Throws TEST_SYSTEM_NOT_CONFIGURED.
export async function testSystemTarget(db, scope) {
  const { found } = await system(db, scope, { purpose: 'test' });
  if (!found) throw testNotConfigured();
  const status = await credentialStatus(
    db,
    scope.organizationId,
    { user: { id: scope.actorId }, sessionId: scope.sessionId },
    found,
    await policyOf(db, scope.organizationId),
  );
  return { ...targetOf(found, status.username), ready: status.state !== 'none' };
}

// The test system with the actor's credential, for test data. Throws
// TEST_SYSTEM_NOT_CONFIGURED or TEST_SYSTEM_LOGIN_REQUIRED.
export async function resolveTestSystem(db, scope) {
  try {
    return await resolveProjectSap(db, scope, { purpose: 'test' });
  } catch (error) {
    if (error.code === 'SAP_NOT_CONFIGURED') throw testNotConfigured();
    if (error.code === 'SAP_LOGIN_REQUIRED')
      throw coded('TEST_SYSTEM_LOGIN_REQUIRED', error.message, error.details);
    throw error;
  }
}
// Test data is the one write to SAP (platform decision 5.6): it needs sap.test_data:create.
export async function assertTestDataAllowed(db, scope) {
  if (!(await permitted(db, scope, 'sap.test_data:create')))
    throw coded('ACCESS_DENIED', '您没有在测试系统创建测试数据的权限。');
}
