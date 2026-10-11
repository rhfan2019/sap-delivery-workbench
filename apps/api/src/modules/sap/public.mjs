export { connectMcp } from '../technical/sap-mcp.mjs';
import { effectiveConfig } from './store.mjs';
import { open } from './crypto.mjs';
// Read-only SAP environment of a project's effective configuration (DEV by default),
// plus the facts an agent may show to the model. Never returns secrets to callers
// other than the MCP environment.
export async function resolveProjectSap(db, scope, environment = 'DEV') {
  const project = (
    await db.query('SELECT * FROM app.project WHERE id=$1 AND organization_id=$2', [
      scope.projectId,
      scope.organizationId,
    ])
  ).rows[0];
  if (!project) throw Object.assign(new Error('SAP_TARGET_DENIED'), { code: 'SAP_TARGET_DENIED' });
  const c = await effectiveConfig(db, scope.organizationId, project, scope.actorId, environment);
  const system = (
    await db.query(
      'SELECT code,name,backend_version AS "backendVersion" FROM app.sap_system WHERE organization_id=$1 AND id=$2',
      [scope.organizationId, c.systemId],
    )
  ).rows[0];
  return {
    target: {
      environment,
      systemCode: system?.code ?? '',
      systemName: system?.name ?? '',
      backendVersion: system?.backendVersion ?? '',
      client: c.client,
    },
    env: {
      SAP_URL: c.sapUrl,
      SAP_CLIENT: c.client,
      SAP_USER: c.username,
      SAP_PASSWORD: c.password ?? open(c.passwordCipher, c.credentialContext),
      SAP_LANGUAGE: c.language ?? 'EN',
      SAP_REQUEST_TIMEOUT_MS: '45000',
      ...(process.env.SAP_MCP_ENTRY ? { SAP_MCP_ENTRY: process.env.SAP_MCP_ENTRY } : {}),
    },
  };
}
export { decodeResult } from '../technical/sap-mcp.mjs';
