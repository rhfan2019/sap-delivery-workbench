import { decodeResult } from '../technical/sap-mcp.mjs';
export const versionQuestion =
  '请说明目标SAP后端产品和版本（例如ECC 6.0 EHP8、S/4HANA 2022）；不知道可填写“未知”，仍可继续业务分析。';
export function unknownProfile(systemId = null, reason = '未选择SAP系统') {
  return {
    systemId,
    discoveryStatus: 'unavailable',
    identificationSource: 'unknown',
    profile: { product: null, productVersion: null, abapRelease: null, deployment: null },
    evidence: [],
    reason,
    question: versionQuestion,
  };
}
export async function identifySystem({ systemId, connect }) {
  let connection;
  try {
    connection = await connect();
    if (!connection.tools.some((t) => t.name === 'tableContents'))
      return unknownProfile(systemId, 'MCP缺少组件读取工具');
    const value = await decodeResult(
      await connection.call('tableContents', {
        ddicEntityName: 'CVERS',
        rowNumber: 200,
        decode: true,
      }),
      connection.call,
    );
    const rows = Array.isArray(value.result)
      ? value.result
      : (value.result?.values ?? value.result?.rows);
    if (!Array.isArray(rows)) return unknownProfile(systemId, 'MCP组件响应格式无法识别');
    const components = rows
      .filter((r) => r && typeof r.COMPONENT === 'string' && typeof r.RELEASE === 'string')
      .map((r) => ({ component: r.COMPONENT.trim(), release: r.RELEASE.trim() }));
    const basis = components.find((r) => r.component === 'SAP_BASIS');
    const s4 = components.find((r) => r.component === 'S4CORE');
    const ecc = components.find((r) => r.component === 'SAP_APPL');
    if (!components.length) return unknownProfile(systemId, '未取得可识别的软件组件');
    return {
      systemId,
      discoveryStatus: 'partial',
      identificationSource: 'mcp',
      profile: {
        product: s4 ? 'SAP S/4HANA' : ecc ? 'SAP ERP' : null,
        productVersion: null,
        abapRelease: basis?.release ?? null,
        deployment: null,
      },
      evidence: [
        {
          tool: 'tableContents',
          entity: 'CVERS',
          retrievedAt: new Date().toISOString(),
          components,
        },
      ],
      reason: '组件版本不等同于产品市场版本或部署模式，未返回的信息保持未知。',
      question: versionQuestion,
    };
  } catch {
    return unknownProfile(systemId, 'SAP连接或组件读取不可用');
  } finally {
    await connection?.close().catch(() => {});
  }
}
