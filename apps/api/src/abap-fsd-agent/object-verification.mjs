import { decodeResult } from '../technical/sap-mcp.mjs';
import { sha256 } from './specification.mjs';
const names = /^(?:\/[A-Z0-9_]+\/)?[A-Z][A-Z0-9_]*(?:-[A-Z][A-Z0-9_]*)?$/;
const types = {
  table: 'TABL',
  structure: 'TABL',
  field: 'TABL',
  data_element: 'DTEL',
  domain: 'DOMA',
  bapi: 'FUGR',
  function_module: 'FUGR',
  class_method: 'CLAS',
  enhancement: 'ENHS',
};
export async function verifyObjects({
  systemId,
  environment = 'DEV',
  candidates,
  connect,
  signal,
  idOffset = 0,
  onTrace = () => {},
}) {
  const objects = structuredClone(candidates),
    evidence = [],
    raw = [];
  let connection;
  try {
    for (let i = 0; i < objects.length; i++) {
      signal?.throwIfAborted();
      const o = objects[i],
        name = o.name.toUpperCase();
      o.verificationStatus = 'unverified';
      o.evidenceIds = [];
      o.verificationScope = '未核验：无可用系统、候选不精确或超出12对象预算';
      if (!systemId || i >= 12 || !names.test(name) || name.length > 61 || !types[o.kind]) continue;
      const trace = [];
      const capturedAt = new Date().toISOString();
      try {
        connection ??= await connect();
        const call = async (tool, args) => {
          const started = performance.now();
          onTrace('sap.started', { objectId: o.id, tool, args, systemId, environment });
          try {
            if (!connection.tools.some((t) => t.name === tool)) throw Error('missing tool');
            const envelope = await connection.call(tool, args);
            const v = await decodeResult(envelope, connection.call);
            trace.push({ tool, args, result: v });
            onTrace('sap.completed', {
              objectId: o.id,
              tool,
              args,
              result: v,
              durationMs: performance.now() - started,
            });
            return v;
          } catch (error) {
            onTrace('sap.failed', {
              objectId: o.id,
              tool,
              durationMs: performance.now() - started,
              code: error.code ?? 'SAP_READ_FAILED',
            });
            throw error;
          }
        };
        const base = name.split('-')[0];
        const found = await call('searchObject', {
          query: base,
          objType: ['bapi', 'function_module'].includes(o.kind) ? 'FUNC' : types[o.kind],
          max: 100,
        });
        const hit = found.results?.find(
          (r) =>
            r['adtcore:name']?.toUpperCase() === base &&
            r['adtcore:type']?.startsWith(types[o.kind] + '/'),
        );
        if (!hit) {
          o.verificationStatus = 'unreadable';
          o.verificationScope = '未检索到精确对象；不能区分不存在与无读取权限';
        } else {
          const uri = hit['adtcore:uri'];
          if (
            typeof uri !== 'string' ||
            !uri.startsWith('/sap/bc/adt/') ||
            uri.includes('..') ||
            /[?#]/.test(uri)
          )
            throw Error('unsafe uri');
          const ddic = types[o.kind] === 'TABL';
          const details = await call(
            ddic ? 'ddicElement' : 'objectStructure',
            ddic ? { path: base } : { objectUrl: uri },
          );
          const d = details.result ?? details.structure;
          const returned = d?.name ?? d?.metaData?.['adtcore:name'];
          if (
            returned?.toUpperCase() !== base ||
            ((d?.type ?? d?.metaData?.['adtcore:type']) &&
              !(d.type ?? d.metaData['adtcore:type']).startsWith(types[o.kind] + '/'))
          ) {
            o.verificationStatus = 'conflicting';
            o.verificationScope = '返回元数据对象与候选不一致';
          } else {
            o.verificationStatus = 'partial';
            o.verificationScope = ddic
              ? '对象存在；元数据可读；字段完整性及业务用途仍需核对'
              : '对象存在；签名/触发上下文及业务用途仍需核对';
            if (ddic && !d.children?.length)
              o.verificationScope = '对象存在但未取得完整字段定义；业务用途未验证';
            if (
              o.kind === 'field' &&
              !d.children?.some((f) => (f.name ?? f['adtcore:name']) === name.split('-')[1])
            )
              o.verificationScope = '父对象存在，目标字段未确认；业务用途未验证';
            if (['data_element', 'domain'].includes(o.kind)) {
              o.verificationScope = '对象存在；精确ADT元信息可读；字段类型和业务用途仍需核对';
              if (connection.tools.some((t) => t.name === 'tableContents')) {
                const entity = o.kind === 'data_element' ? 'DD04L' : 'DD01L';
                const key = o.kind === 'data_element' ? 'ROLLNAME' : 'DOMNAME';
                await call('tableContents', {
                  ddicEntityName: entity,
                  rowNumber: 20,
                  sqlQuery:
                    'SELECT * FROM ' +
                    entity +
                    ' WHERE ' +
                    key +
                    " = '" +
                    base +
                    "' AND AS4LOCAL = 'A'",
                });
                o.verificationScope +=
                  '；已取得活动DDIC定义，只核验本对象，Domain值含义未执行业务验证';
              }
            }
            if (
              ['bapi', 'function_module', 'class_method'].includes(o.kind) &&
              connection.tools.some((t) => t.name === 'getObjectSource')
            ) {
              await call('getObjectSource', {
                objectSourceUrl: uri + '/source/main',
                startLine: 1,
                maxLines: 180,
              });
              o.verificationScope +=
                '；已读取前180行签名来源，超出部分未读，未执行函数/提交或锁测试';
            }
          }
        }
      } catch {
        signal?.throwIfAborted();
        o.verificationStatus = 'unreadable';
        o.verificationScope = '工具不可用、读取失败或响应不完整，未判定不存在';
      }
      const id = 'EVD-' + String(i + 100 + idOffset).padStart(3, '0');
      const record = {
        id,
        systemId,
        environment,
        objectId: o.id,
        name,
        capturedAt,
        trace,
        sha256: sha256(trace),
      };
      raw.push(record);
      evidence.push({
        id,
        channel: 'mcp',
        sourceReference: `evidence:${id}:sha256:${record.sha256}`,
        systemFingerprint: systemId + ':' + environment,
        capturedAt,
        claim: o.verificationScope,
        limitations: '只读元数据核验；存在不代表用途成立，未执行SAP业务写入。',
      });
      o.evidenceIds = [id];
    }
  } finally {
    await connection?.close().catch(() => {});
  }
  return { objects, evidence, raw };
}
