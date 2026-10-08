import { randomUUID } from 'node:crypto';
import { failure } from '../../platform/auth.mjs';
import { version, uuid, text } from '../admin/validation.mjs';
import { modelInput } from './validation.mjs';
import { sealKey } from './crypto.mjs';
import { STRUCTURED_ADAPTER_VERSION } from './inference.mjs';
export const ADAPTER_VERSION = 'text-probe-v1';
const select = `SELECT m.id,m.row_version AS "rowVersion",v.id AS "versionId",v.version_no AS "versionNo",v.config,
 v.credential_id AS "credentialId",m.updated_at AS "updatedAt"
 FROM app.llm_model m JOIN app.llm_model_version v ON v.id=m.latest_version_id AND v.organization_id=m.organization_id`;
export async function getModel(db, org, id) {
  const row = (
    await db.query(select + ' WHERE m.organization_id=$1 AND m.id=$2 AND m.deleted_at IS NULL', [
      org,
      uuid(id),
    ])
  ).rows[0];
  if (!row) throw failure(404, '模型不存在或不属于当前组织。');
  return row;
}
export function publicModel(row) {
  const { config, credentialId, ...rest } = row;
  return { ...rest, ...config, credentialReady: !!credentialId };
}
export async function saveModel(db, org, user, body, id) {
  const config = modelInput(body),
    previous = id ? await getModel(db, org, id) : null;
  if (previous && previous.rowVersion !== version(body.rowVersion))
    throw failure(409, '配置已更新，请刷新后重试。');
  const modelId = id ?? randomUUID(),
    versionId = randomUUID();
  let credentialId = previous?.credentialId;
  if (body.apiKey !== undefined && typeof body.apiKey !== 'string')
    throw failure(400, 'API 密钥格式无效。');
  if (body.apiKey?.trim()) {
    const secret = text(body.apiKey, 'API 密钥', 4096);
    if (/[\r\n]/.test(secret)) throw failure(400, 'API 密钥不可包含换行。');
    credentialId = randomUUID();
    await db.query(
      'INSERT INTO app.llm_credential(id,organization_id,secret_cipher,created_by) VALUES($1,$2,$3,$4)',
      [credentialId, org, sealKey(secret, org, credentialId), user],
    );
  }
  if (!credentialId) throw failure(400, '请填写 API 密钥。');
  if (
    previous &&
    (previous.config.baseUrl !== config.baseUrl || previous.config.protocol !== config.protocol) &&
    !body.apiKey?.trim()
  )
    throw failure(400, '接入地址或协议改变后，请重新输入适用于此服务的密钥。');
  if (!previous)
    await db.query('INSERT INTO app.llm_model(id,organization_id) VALUES($1,$2)', [modelId, org]);
  const n = previous ? BigInt(previous.rowVersion) + 1n : 1n;
  await db.query(
    'INSERT INTO app.llm_model_version(id,organization_id,model_id,version_no,config,credential_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [versionId, org, modelId, n.toString(), config, credentialId, user],
  );
  await db.query(
    'UPDATE app.llm_model SET latest_version_id=$3,row_version=$4,updated_at=clock_timestamp() WHERE organization_id=$1 AND id=$2',
    [org, modelId, versionId, n.toString()],
  );
  return publicModel(await getModel(db, org, modelId));
}
export async function listModels(db, org) {
  const rows = (
    await db.query(
      select +
        ` LEFT JOIN app.llm_default d ON d.organization_id=m.organization_id WHERE m.organization_id=$1 AND m.deleted_at IS NULL ORDER BY (m.id=d.model_id) DESC NULLS LAST,m.created_at,m.id`,
      [org],
    )
  ).rows;
  const tests = (
    await db.query(
      `SELECT DISTINCT ON(version_id,adapter_version) version_id AS "versionId",status,code,safe_message AS message,latency_ms AS "latencyMs",started_at AS "startedAt",expires_at AS "expiresAt",adapter_version AS adapter FROM app.llm_test_run WHERE organization_id=$1 ORDER BY version_id,adapter_version,started_at DESC,id DESC`,
      [org],
    )
  ).rows;
  const d = (
    await db.query(
      `SELECT d.model_id AS id,d.version_id AS "versionId",d.revision,v.config->>'name' AS name FROM app.llm_default d JOIN app.llm_model_version v ON v.id=d.version_id WHERE d.organization_id=$1`,
      [org],
    )
  ).rows[0];
  return {
    items: rows.map((r) => ({
      ...publicModel(r),
      test: tests.find((t) => t.versionId === r.versionId && t.adapter === ADAPTER_VERSION) ?? null,
      structuredTest: tests.find((t) => t.versionId === r.versionId && t.adapter === STRUCTURED_ADAPTER_VERSION) ?? null,
      isDefault: r.id === d?.id,
    })),
    defaultModel: d ?? null,
    defaultRevision: d?.revision ?? '0',
  };
}
// Internal entry point for future operations. No task-specific routing yet.
// Return a pinned version, not an API key; the caller must already authorize the project/data.
export async function resolveDefaultModel(db, org, requiredCapabilities = ['text']) {
  const row = (
    await db.query(
      `SELECT v.id AS "versionId",v.model_id AS "modelId",v.config,v.credential_id AS "credentialId" FROM app.llm_default d JOIN app.llm_model_version v ON v.id=d.version_id AND v.organization_id=d.organization_id JOIN app.llm_model m ON m.id=d.model_id WHERE d.organization_id=$1 AND m.deleted_at IS NULL`,
      [org],
    )
  ).rows[0];
  if (!row) throw failure(409, '尚未配置默认模型，请联系组织管理员。');
  const tests = (
    await db.query(
      'SELECT DISTINCT ON(adapter_version) adapter_version,status,expires_at,capabilities FROM app.llm_test_run WHERE organization_id=$1 AND version_id=$2 AND adapter_version=ANY($3::varchar[]) ORDER BY adapter_version,started_at DESC,id DESC',
      [org, row.versionId, [ADAPTER_VERSION, STRUCTURED_ADAPTER_VERSION]],
    )
  ).rows;
  const capabilities = tests
    .filter((t) => t.status === 'passed' && new Date(t.expires_at) > new Date())
    .flatMap((t) => t.capabilities);
  if (requiredCapabilities.some((c) => !capabilities.includes(c)))
    throw failure(409, '默认模型未验证此操作所需能力，请更换模型。');
  return row;
}
