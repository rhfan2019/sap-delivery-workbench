import { failure } from '../../platform/auth.mjs';
import { text, uuid, choice, version } from '../admin/validation.mjs';

// Contract 3.4: function modules (BAPI or plain FM) and classes that generated test data
// code may call, maintained per SAP system on the administration page.
export const KINDS = ['BAPI', 'FM', 'CLASS'];
const NAME = /^(\/[A-Z0-9_]+\/)?[A-Z][A-Z0-9_]{0,29}$/;
const columns = `id,kind,name,description,active,row_version AS "rowVersion",updated_at AS "updatedAt"`;

export async function listAllowlist(db, org, systemId, { activeOnly = false } = {}) {
  return (
    await db.query(
      `SELECT ${columns} FROM app.sap_system_allowlist WHERE organization_id=$1 AND system_id=$2${activeOnly ? ' AND active' : ''} ORDER BY kind,name`,
      [org, systemId],
    )
  ).rows;
}

export function allowlistInput(body = {}) {
  const name = text(body.name, '名称', 40).toUpperCase();
  if (!NAME.test(name)) throw failure(400, '名称须为有效的 SAP 函数模块或类名，最多 30 位。');
  return {
    kind: choice(body.kind, KINDS, '类型'),
    name,
    description: text(body.description, '说明', 200, { optional: true }),
    active: body.active === undefined ? true : !!body.active,
  };
}

export async function saveAllowlistEntry(db, org, systemId, body) {
  const entry = allowlistInput(body);
  if (body.id) {
    const { rows } = await db.query(
      `UPDATE app.sap_system_allowlist SET kind=$4,name=$5,description=$6,active=$7,row_version=row_version+1,updated_at=now()
       WHERE organization_id=$1 AND system_id=$2 AND id=$3 AND row_version=$8 RETURNING ${columns}`,
      [
        org,
        systemId,
        uuid(body.id),
        entry.kind,
        entry.name,
        entry.description,
        entry.active,
        version(body.rowVersion),
      ],
    );
    if (!rows[0]) throw failure(409, '白名单条目已变化，请刷新后再保存。');
    return rows[0];
  }
  try {
    return (
      await db.query(
        `INSERT INTO app.sap_system_allowlist(organization_id,system_id,kind,name,description,active)
         VALUES($1,$2,$3,$4,$5,$6) RETURNING ${columns}`,
        [org, systemId, entry.kind, entry.name, entry.description, entry.active],
      )
    ).rows[0];
  } catch (error) {
    if (error.code === '23505') throw failure(409, `${entry.name} 已在白名单中。`);
    throw error;
  }
}
