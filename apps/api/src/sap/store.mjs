import { failure } from '../auth.mjs';
import { configInput, revision } from './validation.mjs';
import { seal } from './crypto.mjs';
import { environments, resolveLayers, publicConfig, binding } from './resolve.mjs';
export const systemColumns = `s.id,s.code,s.name,s.owner_customer_id AS "ownerCustomerId",s.sap_url AS "sapUrl",s.language,s.status,s.row_version AS "rowVersion",s.last_test_status AS "testStatus",s.last_test_message AS "testMessage",s.last_test_at AS "testedAt",s.backend_version AS "backendVersion"`;
const columns = `environment,system_id AS "systemId",client,username,language,password_mode AS "passwordMode",password_cipher AS "passwordCipher",credential_binding AS "credentialBinding",row_version AS "rowVersion"`;
const contextKey = (org, project, user, environment) =>
  JSON.stringify([org, project, user ?? 'project', environment]);
export async function systemsFor(db, org, customer) {
  return (
    await db.query(
      `SELECT ${systemColumns} FROM app.sap_system s
    LEFT JOIN app.customer owner ON owner.organization_id=s.organization_id AND owner.id=s.owner_customer_id
    WHERE s.organization_id=$1 AND s.status='active' AND (s.owner_customer_id IS NULL OR owner.status='active')
    AND EXISTS(SELECT 1 FROM app.customer c WHERE c.organization_id=$1 AND c.id=$2 AND c.status='active')
    AND (s.owner_customer_id IS NULL OR s.owner_customer_id=$2 OR EXISTS(
      SELECT 1 FROM app.sap_system_grant g WHERE g.organization_id=s.organization_id AND g.system_id=s.id AND g.customer_id=$2 AND g.active AND g.expires_at>clock_timestamp())) ORDER BY s.name,s.id`,
      [org, customer],
    )
  ).rows;
}
export async function loadRows(db, org, project, user = null) {
  const personal = !!user;
  const rows = (
    await db.query(
      `SELECT ${columns} FROM app.${personal ? 'user_project_sap_config' : 'project_sap_config'} WHERE organization_id=$1 AND project_id=$2${personal ? ' AND user_id=$3' : ''}`,
      [org, project, ...(personal ? [user] : [])],
    )
  ).rows;
  return environments.map((environment) => ({
    ...{
      environment,
      systemId: null,
      client: null,
      username: null,
      language: null,
      passwordMode: personal ? 'inherit' : 'none',
      passwordCipher: null,
      credentialBinding: null,
      rowVersion: '0',
    },
    ...rows.find((r) => r.environment === environment),
    credentialContext: contextKey(org, project, user, environment),
  }));
}
export function safeRow(row) {
  const { environment, systemId, client, username, language, passwordMode, rowVersion } = row;
  return {
    environment,
    systemId,
    client,
    username,
    language,
    passwordMode,
    rowVersion,
    hasPassword: !!row.passwordCipher,
  };
}
export async function configView(db, org, project, user = null) {
  const systems = await systemsFor(db, org, project.customer_id);
  const defaults = await loadRows(db, org, project.id);
  const personal = user ? await loadRows(db, org, project.id, user) : null;
  return {
    projectId: project.id,
    projectName: project.name,
    readOnly: project.status === 'archived',
    systems,
    rows: (personal ?? defaults).map(safeRow),
    defaults: defaults.map(safeRow),
    effective: environments.map((environment, i) => {
      const effective = publicConfig(resolveLayers(systems, defaults[i], personal?.[i]));
      return { environment, ...effective, available: !!effective.sapUrl };
    }),
  };
}
export async function saveRows(db, org, project, user, body) {
  const entries = body?.rows;
  if (
    !Array.isArray(entries) ||
    entries.length !== 3 ||
    new Set(entries.map((r) => r?.environment)).size !== 3 ||
    entries.some((r) => !environments.includes(r?.environment))
  )
    throw failure(400, '必须一起提供 DEV、QAS、PRD 三套配置。');
  const systems = await systemsFor(db, org, project.customer_id);
  const old = await loadRows(db, org, project.id, user);
  const defaults = user ? await loadRows(db, org, project.id) : null;
  for (const [i, env] of environments.entries()) {
    const incoming = entries.find((r) => r.environment === env),
      row = configInput(incoming, !!user),
      prior = old[i];
    if (revision(incoming.rowVersion) !== prior.rowVersion)
      throw failure(409, 'SAP 配置已更新，请重新加载后再保存。');
    if (row.systemId && !systems.some((s) => s.id === row.systemId))
      throw failure(403, '所选 SAP 系统已停用、授权到期或不属于此项目客户。');
    let mode = prior.passwordMode,
      cipher = prior.passwordCipher,
      bound = prior.credentialBinding;
    if (row.passwordAction === 'clear' || row.passwordAction === 'inherit') {
      mode = row.passwordAction === 'inherit' ? 'inherit' : 'none';
      cipher = null;
      bound = null;
    }
    if (row.passwordAction === 'replace') {
      const effective = resolveLayers(systems, user ? defaults[i] : row, user ? row : null);
      if (!effective.sapUrl || !effective.username)
        throw failure(400, '设置密码前须选择可用系统并填写有效用户名。');
      mode = 'override';
      bound = binding(effective);
      cipher = seal(row.password, prior.credentialContext);
    }
    // A kept ciphertext retains its original binding; identity changes cannot rebind it.
    const args = [
      org,
      project.id,
      ...(user ? [user] : []),
      env,
      row.systemId,
      row.client,
      row.username,
      row.language,
      mode,
      cipher,
      bound,
    ];
    const names = [
      'organization_id',
      'project_id',
      ...(user ? ['user_id'] : []),
      'environment',
      'system_id',
      'client',
      'username',
      'language',
      'password_mode',
      'password_cipher',
      'credential_binding',
    ];
    const target = user ? 'user_project_sap_config' : 'project_sap_config';
    await db.query(
      `INSERT INTO app.${target}(${names.join(',')}) VALUES(${args.map((_, n) => '$' + (n + 1)).join(',')})
      ON CONFLICT(organization_id,project_id,${user ? 'user_id,' : ''}environment) DO UPDATE SET
      system_id=EXCLUDED.system_id,client=EXCLUDED.client,username=EXCLUDED.username,language=EXCLUDED.language,
      password_mode=EXCLUDED.password_mode,password_cipher=EXCLUDED.password_cipher,credential_binding=EXCLUDED.credential_binding,
      row_version=${target}.row_version+1,updated_at=now()`,
      args,
    );
  }
  return configView(db, org, project, user);
}
export async function effectiveConfig(db, org, project, user, environment, temporary) {
  if (!environments.includes(environment)) throw failure(400, '请选择 DEV、QAS 或 PRD。');
  const systems = await systemsFor(db, org, project.customer_id),
    defaults = await loadRows(db, org, project.id),
    personal = await loadRows(db, org, project.id, user);
  let temp;
  if (temporary) {
    temp = configInput(temporary, true, true);
    temp.passwordMode =
      temp.passwordAction === 'replace'
        ? 'override'
        : temp.passwordAction === 'clear'
          ? 'none'
          : 'inherit';
  }
  const i = environments.indexOf(environment),
    effective = resolveLayers(systems, defaults[i], personal[i], temp);
  if (!systems.some((s) => s.id === effective.systemId))
    throw failure(403, 'SAP 系统未配置、已停用或客户使用授权已失效。');
  return effective;
}
