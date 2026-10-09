export { connectMcp } from '../technical/sap-mcp.mjs';
import { effectiveConfig } from './store.mjs';
import { open } from './crypto.mjs';
export async function resolveReadEnvironment(db, scope, target) {
  const project = (
    await db.query('SELECT * FROM app.project WHERE id=$1 AND organization_id=$2', [
      scope.projectId,
      scope.organizationId,
    ])
  ).rows[0];
  if (!project) throw Object.assign(new Error('SAP_TARGET_DENIED'), { code: 'SAP_TARGET_DENIED' });
  const c = await effectiveConfig(
    db,
    scope.organizationId,
    project,
    scope.actorId,
    target.environment,
  );
  if (c.systemId !== target.system_id || c.client !== target.client)
    throw Object.assign(new Error('SAP_TARGET_CHANGED'), { code: 'SAP_TARGET_CHANGED' });
  return {
    SAP_URL: c.sapUrl,
    SAP_CLIENT: c.client,
    SAP_USER: c.username,
    SAP_PASSWORD: c.password ?? open(c.passwordCipher, c.credentialContext),
    SAP_LANGUAGE: c.language ?? 'EN',
    SAP_REQUEST_TIMEOUT_MS: '45000',
    ...(process.env.SAP_MCP_ENTRY ? { SAP_MCP_ENTRY: process.env.SAP_MCP_ENTRY } : {}),
  };
}
