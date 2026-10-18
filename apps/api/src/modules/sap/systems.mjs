import { failure } from '../../platform/auth.mjs';

// Project SAP systems (docs/specs/project-access-admin.md 3.2). Rows are returned in the shape
// the API, the agents and the credential store share.
export const systemColumns = `s.id,s.project_id AS "projectId",s.name,s.purpose,s.sid,s.sap_url AS "sapUrl",s.client,s.language,
  s.description,s.is_default AS "isDefault",s.status,s.last_test_status AS "testStatus",s.last_test_message AS "testMessage",
  s.last_test_at AS "testedAt",s.backend_version AS "backendVersion",s.row_version AS "rowVersion",s.updated_at AS "updatedAt"`;

export async function projectSystems(db, org, projectId) {
  return (
    await db.query(
      `SELECT ${systemColumns} FROM app.project_sap_system s WHERE s.organization_id=$1 AND s.project_id=$2
      ORDER BY s.purpose,s.is_default DESC,s.status,s.name,s.id`,
      [org, projectId],
    )
  ).rows;
}
export async function systemById(db, org, projectId, id) {
  const { rows } = await db.query(
    `SELECT ${systemColumns} FROM app.project_sap_system s WHERE s.organization_id=$1 AND s.project_id=$2 AND s.id=$3`,
    [org, projectId, id],
  );
  if (!rows[0]) throw failure(404, 'SAP 系统不存在或不属于此项目。');
  return rows[0];
}

// The system a request means: the chosen one, or the purpose's default; development falls
// back to the item's target system first (section 3.2). Null when none is usable.
export async function selectSystem(db, org, projectId, { systemId, purpose, itemId } = {}) {
  if (systemId) {
    const system = await systemById(db, org, projectId, systemId);
    return system.status === 'active' ? system : null;
  }
  if (purpose === 'development' && itemId) {
    const { rows } = await db.query(
      `SELECT ${systemColumns} FROM app.development_item i JOIN app.project_sap_system s ON s.id=i.sap_system_id
      WHERE i.organization_id=$1 AND i.project_id=$2 AND i.id=$3 AND s.status='active'`,
      [org, projectId, itemId],
    );
    if (rows[0]) return rows[0];
  }
  const { rows } = await db.query(
    `SELECT ${systemColumns} FROM app.project_sap_system s WHERE s.organization_id=$1 AND s.project_id=$2
    AND s.purpose=$3 AND s.is_default AND s.status='active'`,
    [org, projectId, purpose],
  );
  return rows[0] ?? null;
}
// The labels agents and run records use for a system's purpose.
export const environmentOf = (system) => (system.purpose === 'development' ? 'DEV' : 'QAS');
export const purposeLabel = (purpose) => (purpose === 'development' ? '开发系统' : '测试系统');
