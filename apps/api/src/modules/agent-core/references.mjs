import { richText } from '@sap-delivery-workbench/contracts/delivery/fields';
import { failure } from '../../platform/auth.mjs';
import { parseFile } from './attachments/parser.mjs';

// Materials already on the item that a message may reference instead of uploading them again
// (docs/specs/agent-workspace-start-and-composer.md 4.2): the business function, the item's
// files and the files of the item's other conversations. A reference is copied into the
// session's attachments once (storage key `ref:<kind>:<id>`), then read like an upload.
export const MAX_REFERENCES = 10;
export const REFERENCE_KINDS = ['business_function', 'item_file', 'session_file'];
const BUSINESS_FUNCTION = '业务功能点.txt';

const kb = (bytes) => `${Math.max(1, Math.ceil(bytes / 1024))} KB`;

// What the reference picker lists. `kinds` are the kinds this assistant accepts.
export function referenceCatalog({ item, files, others, kinds }) {
  const text = richText(item.business_function);
  const groups = [
    {
      key: 'item',
      heading: '开发项',
      items: [
        {
          kind: 'business_function',
          id: 'item',
          label: '业务功能点',
          detail: text ? `${text.length} 字` : '尚未填写',
          disabled: !text,
        },
      ],
    },
  ];
  if (kinds.includes('item_file'))
    groups.push({
      key: 'files',
      heading: '开发项附件',
      items: files.map((f) => ({
        kind: 'item_file',
        id: f.id,
        label: f.name,
        detail: kb(Number(f.size)),
      })),
    });
  groups.push({
    key: 'sessions',
    heading: '本开发项的其他对话',
    items: others.map((a) => ({
      kind: 'session_file',
      id: a.id,
      label: a.fileName,
      detail: `对话“${a.sessionTitle?.trim() || '未命名对话'}” · ${kb(Number(a.size))}`,
    })),
  });
  return groups.filter((g) => g.items.length);
}

// The attachment rows the references of one message become. Unknown or foreign ids are 404
// (they are not on this item); a kind this assistant does not take is 400.
export async function resolveReferences(raw, { item, files, others, kinds, parse = parseFile }) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > MAX_REFERENCES) throw failure(400, '引用资料无效。');
  const rows = new Map();
  for (const r of raw) {
    const kind = String(r?.kind ?? ''),
      id = String(r?.id ?? '');
    if (!kinds.includes(kind)) throw failure(400, '这个助手不能引用这类资料。');
    const storageKey = `ref:${kind}:${id}`;
    if (rows.has(storageKey)) continue;
    if (kind === 'business_function') {
      const text = richText(item.business_function);
      if (!text) throw failure(400, '业务功能点尚未填写。');
      rows.set(storageKey, {
        storageKey,
        fileName: BUSINESS_FUNCTION,
        size: Buffer.byteLength(text),
        parseState: 'ready',
        text,
        warnings: [],
      });
    } else if (kind === 'item_file') {
      const f = files.find((x) => x.id === id);
      if (!f) throw failure(404, '引用的开发项附件不存在。');
      const parsed = await parse(f.path, f.name);
      rows.set(storageKey, {
        storageKey,
        fileName: f.name,
        size: Number(f.size),
        parseState: parsed.state,
        text: (parsed.regions ?? []).map((x) => x.text).join('\n\n'),
        warnings: parsed.warnings ?? [],
      });
    } else {
      const a = others.find((x) => x.id === id);
      if (!a) throw failure(404, '引用的对话资料不存在。');
      rows.set(storageKey, {
        storageKey,
        fileName: a.fileName,
        size: Number(a.size),
        parseState: a.parseState,
        text: a.text ?? '',
        warnings: a.warnings ?? [],
      });
    }
  }
  return [...rows.values()];
}
