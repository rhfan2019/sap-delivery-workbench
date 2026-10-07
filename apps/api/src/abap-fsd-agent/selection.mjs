import { failure } from '../auth.mjs';
import { effectiveConfig, loadRows, systemsFor } from '../sap/store.mjs';
import { publicConfig } from '../sap/resolve.mjs';
import { open } from '../sap/crypto.mjs';
import { connectMcp } from '../technical/sap-mcp.mjs';
import { identifySystem, unknownProfile } from './sap-profile.mjs';
import sanitizeHtml from 'sanitize-html';
export async function pinAssociation(db, org, current, selection, delivery) {
  if (!selection.projectId) {
    if (selection.itemId) throw failure(400, '关联开发项必须选择项目。');
    return { project: null, association: null };
  }
  const project = await delivery.access(db, current, selection.projectId, true);
  if (!selection.itemId)
    return {
      project,
      association: {
        organizationId: org,
        projectId: project.id,
        projectName: project.name,
        itemId: null,
      },
    };
  const {
    rows: [item],
  } = await db.query(
    'SELECT id,code,name,module,kind,summary,summary_format,acceptance,row_version FROM app.development_item WHERE organization_id=$1 AND project_id=$2 AND id=$3 AND deleted_at IS NULL',
    [org, project.id, selection.itemId],
  );
  if (!item) throw failure(404, '开发项不存在或不属于所选项目。');
  if (String(item.row_version) !== selection.itemRowVersion)
    throw failure(409, '开发项需求已变化，请新建对话后点击“刷新开发项”，重新选择后发送。');
  return {
    project,
    association: {
      organizationId: org,
      projectId: project.id,
      projectName: project.name,
      itemId: item.id,
      itemCode: item.code,
      rowVersion: String(item.row_version),
      requirement: {
        name: item.name,
        module: item.module,
        kind: item.kind,
        summary:
          item.summary_format === 'html'
            ? sanitizeHtml(item.summary ?? '', { allowedTags: [], allowedAttributes: {} })
            : item.summary,
        acceptance: item.acceptance,
      },
    },
  };
}
export function createProfileResolver({ pool, org, connect = connectMcp }) {
  let active = 0;
  return async function resolve(project, current, selection) {
    let result = unknownProfile(selection.systemId);
    if (selection.systemId) {
      // Validate ownership even when there is no project credential context.
      const {
        rows: [system],
      } = await pool.query(
        'SELECT id,status,backend_version FROM app.sap_system WHERE organization_id=$1 AND id=$2',
        [org, selection.systemId],
      );
      if (!system) throw failure(404, 'SAP系统不存在或不属于当前企业。');
      if (system.status !== 'active') result = unknownProfile(system.id, '所选SAP系统已停用');
      else if (system.backend_version?.trim()) {
        result = {
          ...unknownProfile(system.id),
          discoveryStatus: 'partial',
          identificationSource: 'configuration',
          question: null,
          profile: {
            product: /S4CORE|S\/4\s*HANA/i.test(system.backend_version)
              ? 'SAP S/4HANA'
              : /SAP_APPL|ECC/i.test(system.backend_version)
                ? 'SAP ERP'
                : null,
            productVersion: system.backend_version.trim(),
            abapRelease:
              /(?:SAP_BASIS|ABAP)[\s:=]+([0-9.]+)/i.exec(system.backend_version)?.[1] ?? null,
            deployment: null,
          },
          reason: '版本来自SAP系统配置，未重复调用MCP；不代表业务数据已核验。',
        };
      } else if (!project)
        result = unknownProfile(
          system.id,
          '请选择项目以使用该项目的SAP连接参数；也可先提供产品版本',
        );
      else {
        if (active >= 2) throw failure(429, 'SAP识别繁忙，请稍后重试。');
        active++;
        try {
          const c = await effectiveConfig(
            pool,
            org,
            project,
            current.user.id,
            selection.environment ?? 'DEV',
            { systemId: selection.systemId },
          );
          if (!publicConfig(c).credentialReady)
            result = unknownProfile(system.id, '该系统缺少匹配的项目或个人连接凭据');
          else {
            const env = {
              SAP_MCP_ENTRY: process.env.SAP_MCP_ENTRY,
              NODE_EXTRA_CA_CERTS: process.env.NODE_EXTRA_CA_CERTS,
              SAP_ALLOW_HTTP: process.env.SAP_ALLOW_HTTP,
              SAP_REQUEST_TIMEOUT_MS: process.env.SAP_REQUEST_TIMEOUT_MS,
              SAP_URL: c.sapUrl,
              SAP_CLIENT: c.client ?? '',
              SAP_LANGUAGE: c.language,
              SAP_USER: c.username,
              SAP_PASSWORD: c.password ?? open(c.passwordCipher, c.credentialContext),
            };
            result = await identifySystem({ systemId: system.id, connect: () => connect(env) });
          }
        } catch (e) {
          if (e.statusCode === 403) throw e;
          result = unknownProfile(system.id, 'SAP连接配置或识别不可用');
        } finally {
          active--;
        }
      }
    }
    const statement = selection.consultantVersion?.trim();
    if (statement) {
      result = {
        ...result,
        identificationSource:
          result.identificationSource === 'mcp' ? 'mcp+consultant' : 'consultant',
        consultantStatement: statement,
        question: null,
      };
    }
    return result;
  };
}

export async function connectSelected({
  pool,
  org,
  project,
  current,
  selection,
  connect = connectMcp,
}) {
  if (!project || !selection.systemId) throw failure(400, '未选择SAP项目和系统');
  const c = await effectiveConfig(
    pool,
    org,
    project,
    current.user.id,
    selection.environment ?? 'DEV',
    { systemId: selection.systemId },
  );
  if (!publicConfig(c).credentialReady) throw failure(503, 'SAP凭据不可用');
  return connect({
    SAP_MCP_ENTRY: process.env.SAP_MCP_ENTRY,
    NODE_EXTRA_CA_CERTS: process.env.NODE_EXTRA_CA_CERTS,
    SAP_ALLOW_HTTP: process.env.SAP_ALLOW_HTTP,
    SAP_REQUEST_TIMEOUT_MS: process.env.SAP_REQUEST_TIMEOUT_MS,
    SAP_URL: c.sapUrl,
    SAP_CLIENT: c.client ?? '',
    SAP_LANGUAGE: c.language,
    SAP_USER: c.username,
    SAP_PASSWORD: c.password ?? open(c.passwordCipher, c.credentialContext),
  });
}

// Project defaults choose both roles; explicit per-conversation overrides stay local.
export async function resolveTargetSelection(db, org, current, selection, delivery) {
  if (!selection.projectId) return { ...selection, environment: 'DEV' };
  const project = await delivery.access(db, current, selection.projectId, true);
  const defaults = await loadRows(db, org, project.id);
  const systems = await systemsFor(db, org, project.customer_id);
  const result = {
    ...selection,
    environment: 'DEV',
    systemId:
      selection.systemId === undefined
        ? (defaults.find((r) => r.environment === 'DEV')?.systemId ?? null)
        : selection.systemId,
    qasSystemId:
      selection.qasSystemId === undefined
        ? (defaults.find((r) => r.environment === 'QAS')?.systemId ?? null)
        : selection.qasSystemId,
  };
  for (const id of [result.systemId, result.qasSystemId])
    if (id && !systems.some((s) => s.id === id))
      throw failure(403, 'SAP目标未授权给当前项目或已停用。');
  return result;
}
