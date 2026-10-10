// Pure, browser-safe helpers for the fsd-report/1 content model: object ids,
// [[ID]] references and SAP object references. No file system, no Ajv.

export const FSD_REPORT_VERSION = 'fsd-report/1';

// Fixed chapter-2 sections and the messages section; referable as [[SEC-...]].
export const RESERVED_SECTIONS = Object.freeze([
  'SEC-OVERVIEW',
  'SEC-REQUIREMENT',
  'SEC-AUTH',
  'SEC-SELECTION',
  'SEC-CHECKS',
  'SEC-OUTPUT',
  'SEC-ACTIONS',
  'SEC-MESSAGES',
]);

const REFERENCE = /\[\[([^\]\s]+)\]\]/g;

function walk(value, path, visit) {
  if (Array.isArray(value)) return value.forEach((item, i) => walk(item, `${path}/${i}`, visit));
  visit(value, path);
  if (value && typeof value === 'object')
    for (const [key, item] of Object.entries(value)) walk(item, `${path}/${key}`, visit);
}

/** Every object id in the document, with its JSON pointer; duplicates reported separately. */
export function collectObjectIds(doc) {
  const ids = new Map();
  const duplicates = [];
  walk(doc, '', (value, path) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    if (typeof value.id !== 'string') return;
    if (ids.has(value.id)) duplicates.push({ id: value.id, path, first: ids.get(value.id) });
    else ids.set(value.id, path);
  });
  return { ids, duplicates };
}

/** Every [[ID]] occurrence in string values, plus working.open_issues[].related ids. */
export function findReferences(doc) {
  const refs = [];
  walk(doc, '', (value, path) => {
    if (typeof value === 'string')
      for (const m of value.matchAll(REFERENCE)) refs.push({ id: m[1], path });
  });
  (doc?.working?.open_issues ?? []).forEach((issue, i) =>
    (issue.related ?? []).forEach((id, j) =>
      refs.push({ id, path: `/working/open_issues/${i}/related/${j}` }),
    ),
  );
  return refs;
}

/** Reference closure: unknown targets and duplicate ids. Reserved section ids cannot be redefined. */
export function checkReferences(doc) {
  const { ids, duplicates } = collectObjectIds(doc);
  const reserved = new Set(RESERVED_SECTIONS);
  const redefined = [...ids.entries()]
    .filter(([id]) => reserved.has(id))
    .map(([id, path]) => ({ id, path }));
  const dangling = findReferences(doc).filter((ref) => !ids.has(ref.id) && !reserved.has(ref.id));
  return {
    ok: !dangling.length && !duplicates.length && !redefined.length,
    dangling,
    duplicates,
    redefined,
  };
}

/** Distinct SAP objects declared by logic sections, in first-seen order. */
export function collectSapRefs(doc) {
  const seen = new Map();
  for (const section of doc?.logic?.sections ?? [])
    for (const ref of section.sap_refs ?? []) {
      const key = `${ref.type} ${ref.name}`;
      if (!seen.has(key)) seen.set(key, { type: ref.type, name: ref.name, sections: [] });
      seen.get(key).sections.push(section.id);
    }
  return [...seen.values()];
}
