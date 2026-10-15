import { createHash } from 'node:crypto';
import { itemDocuments, itemDocument } from '../abap-fsd-agent/public.mjs';
import { parseFile, truncate } from '../agent-core/public.mjs';
import { readPlanSection } from './artifacts.mjs';

// The inputs a development session works from (decision 2.1): the development-list item,
// FSD versions from the design agent, files uploaded to the item, chat attachments and the
// framework classes. Every material has a stable key and a digest, so a version records
// what it was built on and the next turn can tell what changed since.

const KIND = { report: '报表', function: '功能', interface: '接口', enhancement: '增强' };
const CHANGE = { new: '新增', rebuild: '重构', optimize: '优化' };
const MAX_FSD_VERSIONS = 20;
const MAX_MATERIAL_CHARS = 40000;

const hash = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16);

export function itemFacts(scope, objects) {
  return [
    `开发项：${scope.itemCode} ${scope.itemName}`,
    `开发类型：${KIND[scope.itemKind] ?? scope.itemKind}`,
    `变更类型：${CHANGE[scope.changeType] ?? scope.changeType}`,
    `事务码：${scope.transactionCode || '未登记'}`,
    `开发对象：${objects.length ? objects.map((o) => `${o.pgmid} ${o.objectType} ${o.objectName}`).join('；') : '未登记'}`,
  ].join('\n');
}

export async function collectMaterials(db, { scope, objects, files, attachments, framework }) {
  const facts = itemFacts(scope, objects);
  const fsd = (await itemDocuments(db, scope.organizationId, scope.itemId)).slice(
    0,
    MAX_FSD_VERSIONS,
  );
  return [
    { key: 'item', type: 'item', label: '开发清单信息', digest: hash(facts), text: facts },
    ...fsd.map((d) => ({
      key: `fsd:${d.sessionId}:${d.version}`,
      type: 'fsd',
      label: `FSD 第 ${d.version} 版（设计会话“${d.sessionTitle || '未命名'}”${d.labels?.length ? `，标签：${d.labels.join('、')}` : ''}）`,
      digest: d.digest,
      sessionId: d.sessionId,
      version: d.version,
    })),
    ...files.map((f) => ({
      key: `file:${f.id}`,
      type: 'file',
      label: `开发项文件 ${f.name}`,
      digest: f.checksum,
      name: f.name,
      path: f.path,
    })),
    ...attachments.map((a) => ({
      key: `attachment:${a.id}`,
      type: 'attachment',
      label: `对话附件 ${a.fileName}`,
      digest: a.id,
      id: a.id,
      text: a.text ?? '',
      parseState: a.parseState,
    })),
    ...framework.map((c) => ({
      key: `framework:${c.name}`,
      type: 'framework',
      label: `框架类 ${c.name}（${c.origin === 'sap' ? '目标系统' : '内置副本'}）`,
      digest: c.digest,
    })),
  ];
}

// What a version records as its basis.
export const basisOf = (materials) =>
  materials.map(({ key, type, label, digest }) => ({ key, type, label, digest }));

// Marks materials that are new or changed relative to the basis of the current version.
export function markChanges(materials, basis) {
  if (!basis) return materials.map((m) => ({ ...m, change: '' }));
  const known = new Map(basis.map((b) => [b.key, b.digest]));
  return materials.map((m) => ({
    ...m,
    change: !known.has(m.key) ? 'new' : known.get(m.key) !== m.digest ? 'changed' : '',
  }));
}

export function materialList(materials) {
  const mark = { new: '【新增】', changed: '【有变化】', '': '' };
  return materials.map((m) => `- ${mark[m.change ?? '']}${m.label}（编号：${m.key}）`).join('\n');
}

// Reads one material for the model; FSDs can be read by section.
export async function readMaterial(db, scope, materials, key, section, { parse = parseFile } = {}) {
  const m = materials.find((x) => x.key === key);
  if (!m) throw new Error(`没有编号为 ${key} 的资料，请先用 list_materials 查看。`);
  let text = '';
  if (m.type === 'item') text = m.text;
  else if (m.type === 'fsd') {
    const doc = await itemDocument(db, scope.organizationId, scope.itemId, m.sessionId, m.version);
    if (!doc) throw new Error('这一版 FSD 已不存在。');
    text = section ? readPlanSection(doc.markdown, section) : doc.markdown;
  } else if (m.type === 'file') {
    m.parsed ??= await parse(m.path, m.name);
    const regions = m.parsed.regions ?? [];
    text = regions.length
      ? regions.map((r) => r.text).join('\n\n')
      : `（未能读取：${(m.parsed.warnings ?? []).join('；') || m.parsed.state}）`;
  } else if (m.type === 'attachment') text = m.text || `（未能读取：${m.parseState}）`;
  else if (m.type === 'framework') text = '框架类的定义已在“框架接口”一节中给出，不需要读取。';
  return truncate(`${m.label}\n\n${text}`, MAX_MATERIAL_CHARS);
}
