// Applying a parsed wire fragment (a write or revision answer) onto an fsd-report/1
// document. Pure and browser-safe.
//
// - Objects with an id (table rows, notes, logic sections) are upserted by id, keeping
//   their position; new ones are appended. A logic section is replaced as a whole.
// - Plain lists (goals, scope, requirements, rules, roles, change log) are replaced when
//   the fragment carries any item, otherwise kept.
// - Scalars (overview keys, intros, notes, background) are replaced when present.
// - Deleted ids are removed wherever they occur.
// rev counts content changes of an object: new objects get 1, changed ones +1.

const ID_COLLECTIONS = [
  ['authorizations', 'items'],
  ['authorizations', 'notes'],
  ['selection_screen', 'fields'],
  ['selection_checks', 'items'],
  ['output', 'fields'],
  ['actions', 'items'],
  ['messages', 'items'],
  ['working', 'open_issues'],
  ['working', 'lifecycle'],
  ['working', 'reverse_review'],
  ['working', 'evidence'],
];
const LISTS = [
  ['requirement', 'goals'],
  ['requirement', 'scope_in'],
  ['requirement', 'scope_out'],
  ['requirement', 'constraints'],
  ['requirement', 'roles'],
  ['output', 'requirements'],
  ['actions', 'interaction_rules'],
  ['doc', 'change_log'],
];
const SCALARS = [
  ['requirement', 'background'],
  ['requirement', 'goals_intro'],
  ['authorizations', 'intro'],
  ['selection_screen', 'intro'],
  ['selection_screen', 'note'],
  ['selection_checks', 'intro'],
  ['output', 'intro'],
  ['logic', 'intro'],
  ['messages', 'note'],
];
const OBJECTS = ['doc', 'target', 'overview'];

const withoutRev = (o) => JSON.stringify(o, (k, v) => (k === 'rev' ? undefined : v));

function upsert(list, incoming, changed) {
  for (const obj of incoming) {
    const i = list.findIndex((x) => x.id === obj.id);
    if (i < 0) {
      list.push({ ...obj, rev: 1 });
      changed.add(obj.id);
    } else if (withoutRev(list[i]) !== withoutRev(obj)) {
      list[i] = { ...obj, rev: (list[i].rev ?? 1) + 1 };
      changed.add(obj.id);
    }
  }
}

/**
 * @returns {{ doc: object, changed: string[] }} the merged copy and the ids whose
 *   content changed (logic sections by section id; scalar and list changes by path).
 */
export function mergeFsdPatch(base, fragment, deletions = []) {
  const doc = structuredClone(base);
  const changed = new Set();
  for (const key of OBJECTS) {
    const patch = fragment[key];
    if (!patch) continue;
    for (const [k, v] of Object.entries(patch)) {
      if (k === 'change_log') continue;
      doc[key] ??= {};
      if (JSON.stringify(doc[key][k]) !== JSON.stringify(v)) {
        doc[key][k] = structuredClone(v);
        changed.add(`/${key}/${k}`);
      }
    }
  }
  for (const [a, b] of SCALARS) {
    const v = fragment[a]?.[b];
    if (v === undefined || doc[a]?.[b] === v) continue;
    doc[a] ??= {};
    doc[a][b] = v;
    changed.add(`/${a}/${b}`);
  }
  for (const [a, b] of LISTS) {
    const v = fragment[a]?.[b];
    if (!v?.length || JSON.stringify(doc[a]?.[b]) === JSON.stringify(v)) continue;
    doc[a] ??= {};
    doc[a][b] = structuredClone(v);
    changed.add(`/${a}/${b}`);
  }
  for (const [a, b] of ID_COLLECTIONS) {
    const v = fragment[a]?.[b];
    if (!v?.length) continue;
    doc[a] ??= {};
    doc[a][b] ??= [];
    upsert(doc[a][b], v, changed);
  }
  if (fragment.logic?.sections?.length) {
    doc.logic ??= { sections: [] };
    upsert(doc.logic.sections, fragment.logic.sections, changed);
  }
  if (deletions.length) {
    const gone = new Set(deletions);
    const drop = (list) => {
      const kept = list.filter((x) => !gone.has(x.id));
      for (const x of list) if (gone.has(x.id)) changed.add(x.id);
      return kept;
    };
    for (const [a, b] of ID_COLLECTIONS) if (doc[a]?.[b]) doc[a][b] = drop(doc[a][b]);
    if (doc.logic?.sections) {
      doc.logic.sections = drop(doc.logic.sections);
      for (const s of doc.logic.sections) {
        const before = s.blocks.length;
        s.blocks = drop(s.blocks);
        if (s.blocks.length !== before) s.rev = (s.rev ?? 1) + 1;
      }
    }
  }
  return { doc, changed: [...changed] };
}

/** Logic sections in the order an outline lists them; sections the outline lacks keep their place at the end. */
export function orderSections(doc, outline) {
  const rank = new Map(outline.filter((o) => o.type === '逻辑').map((o, i) => [o.id, i]));
  const out = structuredClone(doc);
  out.logic.sections.sort((x, y) => (rank.get(x.id) ?? 1e9) - (rank.get(y.id) ?? 1e9));
  return out;
}
