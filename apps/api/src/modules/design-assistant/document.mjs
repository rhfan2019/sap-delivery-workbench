// Server-side handling of the FSD document (fsd-report/1) around the model calls of N07:
// what the program fills itself, which wire parts each call writes, and how a failing
// part of a merged draft is traced back to the call that writes it.
import { emptyWireDoc } from '@sap-delivery-workbench/contracts/design-assistant/fsd-report-wire';
import {
  checkReferences,
  validateFsdReport,
} from '@sap-delivery-workbench/contracts/design-assistant/fsd-report';
import { evidenceAlias } from './model.mjs';

const PRODUCTS = new Set(['ECC', 'S4_OP', 'S4_PCE']);
const today = () => new Date().toISOString().slice(0, 10);

// First write of a document: fixed parts in two calls, each logic section in its own call
// (added per outline entry), then messages and the analysis tables, which cover the sections.
export const WRITE_JOBS = Object.freeze([
  { key: 'require', parts: ['overview', 'requirement'] },
  {
    key: 'spec',
    parts: ['authorizations', 'selection_screen', 'selection_checks', 'output', 'actions', 'logic'],
  },
  { key: 'tail', parts: ['messages', 'lifecycle', 'reverse_review', 'open_issues'] },
]);

/**
 * Cover, target and evidence come from the program, never from the model. evidence is the
 * list the model saw (same order), so EV-001… in the document resolve to these entries.
 */
export function draftSkeleton(t, evidence) {
  const cover = t.cover ?? {};
  const firstLine = (t.input?.text ?? '').split('\n')[0].trim().slice(0, 40);
  const doc = {
    ...emptyWireDoc(),
    doc: {
      doc_id: cover.doc_id || 'FSD',
      title: cover.title || firstLine || '开发功能说明书',
      project: cover.project || '（项目名称）',
      author_org: '（实施公司名称）',
      version: 'V1.0',
      change_log: [{ version: 'V1.0', date: today(), content: '创建' }],
    },
  };
  if (PRODUCTS.has(t.target?.product))
    doc.target = {
      product: t.target.product,
      ...(t.target.release ? { release: t.target.release } : {}),
      ...(t.target.basis_release ? { basis_release: t.target.basis_release } : {}),
      source: 'SYSTEM',
    };
  if (evidence.length)
    doc.working = {
      evidence: evidence.map((e, i) => ({
        id: evidenceAlias(i),
        source_kind: 'SAP',
        object: String(e.data?.name ?? e.data?.object ?? e.gap_id ?? 'SAP 对象'),
        summary: e.data ? JSON.stringify(e.data).slice(0, 300) : '已读取',
        ...(Number.isFinite(Date.parse(e.observed_at)) ? { observed_at: e.observed_at } : {}),
      })),
    };
  return doc;
}

const WORKING_PARTS = ['lifecycle', 'reverse_review', 'open_issues', 'evidence'];
/** The fragment of a parsed answer that belongs to the given parts; anything else is ignored. */
export function pickParts(doc, parts) {
  const out = {};
  for (const part of parts) {
    if (part.startsWith('section:')) {
      const id = part.slice('section:'.length);
      out.logic ??= { sections: [] };
      out.logic.sections.push(...(doc.logic?.sections ?? []).filter((s) => s.id === id));
    } else if (part === 'sections') {
      out.logic ??= { sections: [] };
      out.logic.sections.push(...(doc.logic?.sections ?? []));
    } else if (part === 'logic') {
      out.logic ??= { sections: [] };
      if (doc.logic?.intro) out.logic.intro = doc.logic.intro;
    } else if (WORKING_PARTS.includes(part)) {
      if (doc.working?.[part]) (out.working ??= {})[part] = doc.working[part];
    } else if (doc[part]) out[part] = doc[part];
  }
  return out;
}

const PART_NAMES = {
  overview: '开发概览',
  requirement: '业务需求',
  authorizations: '权限校验',
  selection_screen: '选择屏幕',
  selection_checks: '选择屏幕检查',
  output: '输出布局',
  actions: '功能按钮',
};
const present = {
  overview: (d) => Object.keys(d.overview ?? {}).length > 0,
  requirement: (d) => !!d.requirement?.background || (d.requirement?.goals ?? []).length > 0,
  authorizations: (d) => (d.authorizations?.items ?? []).length > 0,
  selection_screen: (d) => (d.selection_screen?.fields ?? []).length > 0,
  selection_checks: (d) => (d.selection_checks?.items ?? []).length > 0,
  output: (d) => (d.output?.fields ?? []).length > 0,
  actions: (d) => (d.actions?.items ?? []).length > 0,
};

/** Problems that make a write answer unusable for its job (checked before the one repair). */
export function partProblems(job) {
  return ({ doc }) => {
    if (job.section)
      return (doc.logic?.sections ?? []).some((s) => s.id === job.section.id)
        ? []
        : [{ message: `没有写出“## 逻辑 ${job.section.id} ${job.section.title}”` }];
    return job.parts
      .filter((p) => present[p] && !present[p](doc))
      .map((p) => ({ message: `缺少“## ${PART_NAMES[p]}”部分` }));
  };
}

export function outlineProblems({ outline }) {
  const problems = [];
  if (!outline.some((o) => o.type === '逻辑'))
    problems.push({ message: '提纲中没有业务逻辑章节（类型=逻辑）' });
  const seen = new Set();
  for (const o of outline) {
    const prefix = o.type === '逻辑' ? 'LOG' : o.type === '消息' ? 'MSG' : null;
    if (!prefix) problems.push({ message: `${o.id}：类型只能是“逻辑”或“消息”` });
    else if (!new RegExp(`^${prefix}-[A-Z0-9]+(-[A-Z0-9]+)*$`).test(o.id ?? ''))
      problems.push({ message: `${o.id}：编号应为 ${prefix}-英文大写名称` });
    if (seen.has(o.id)) problems.push({ message: `${o.id}：编号重复` });
    seen.add(o.id);
    if (o.type === '逻辑' && !o.title) problems.push({ message: `${o.id}：缺少标题` });
  }
  return problems;
}

/** The write job that owns a JSON pointer of the document; null for program-owned parts. */
export function jobForPath(path, draft) {
  const [, head, sub, index] = path.split('/');
  if (['overview', 'requirement'].includes(head)) return WRITE_JOBS[0];
  if (
    ['authorizations', 'selection_screen', 'selection_checks', 'output', 'actions'].includes(head)
  )
    return WRITE_JOBS[1];
  if (head === 'logic') {
    const section = sub === 'sections' && index !== undefined ? draft.logic.sections[index] : null;
    return section
      ? {
          key: 'section:' + section.id,
          parts: ['section:' + section.id],
          section: { id: section.id, title: section.title },
        }
      : WRITE_JOBS[1];
  }
  if (head === 'messages' || head === 'working') return WRITE_JOBS[2];
  return null;
}

/**
 * Removes [[ID]] references to objects no part defines (and such ids in open-issue links)
 * and lists them in one open item, so the document stays readable and checkable.
 */
export function dropDanglingReferences(doc) {
  const { dangling } = checkReferences(doc);
  if (!dangling.length) return { doc, removed: [] };
  const gone = new Set(dangling.map((d) => d.id));
  const clean = JSON.parse(
    JSON.stringify(doc, (k, v) =>
      typeof v === 'string'
        ? v.replace(/\[\[([^\]\s]+)\]\]/g, (m, id) => (gone.has(id) ? '' : m))
        : v,
    ),
  );
  for (const issue of clean.working?.open_issues ?? [])
    if (issue.related) issue.related = issue.related.filter((id) => !gone.has(id));
  clean.working ??= {};
  clean.working.open_issues = [
    ...(clean.working.open_issues ?? []).filter((i) => i.id !== 'ISS-DANGLING-REFS'),
    {
      id: 'ISS-DANGLING-REFS',
      title:
        '以下被引用的对象没有定义，引用已从正文移除，需补充定义或确认不需要：' +
        [...gone].join('、'),
      blocking: false,
      status: 'OPEN',
    },
  ];
  return { doc: clean, removed: [...gone] };
}

/**
 * Keeps a draft the content model rejects: removes the smallest list entry (row, item,
 * block, section) each error points into, until the document is valid, and lists what was
 * removed in one open issue. Returns the errors left when an error is not inside a list
 * (the document skeleton itself is broken); the caller decides then.
 */
export function salvageDocument(doc) {
  let clean = structuredClone(doc);
  const removed = [];
  for (let round = 0; round < 200; round++) {
    // A removed section leaves references to it; those go, not the rows that cite it.
    clean = dropDanglingReferences(clean).doc;
    const check = validateFsdReport(clean);
    if (check.ok) break;
    const hit = check.errors
      .map((e) => ({ e, at: lastListEntry(clean, e.path) }))
      .find((x) => x.at);
    if (!hit) return { doc: clean, removed, errors: check.errors };
    const [item] = hit.at.list.splice(hit.at.index, 1);
    removed.push({
      path: hit.e.path,
      message: hit.e.message,
      // Quoted, not cited: [[ID]] in the removed text would count as a reference again.
      content: JSON.stringify(item)
        .replace(/\[\[|\]\]/g, '')
        .slice(0, 300),
    });
  }
  if (!removed.length) return { doc: clean, removed, errors: [] };
  clean.working ??= {};
  clean.working.open_issues = [
    ...(clean.working.open_issues ?? []).filter((i) => i.id !== 'ISS-QC-REMOVED'),
    {
      id: 'ISS-QC-REMOVED',
      title: `程序检查剔除了 ${removed.length} 处不符合文档格式的内容，需复核后补充`,
      impact: removed.map((r) => `- ${r.path}：${r.message}；原内容 ${r.content}`).join('\n'),
      blocking: false,
      status: 'OPEN',
    },
  ];
  const check = validateFsdReport(clean);
  return { doc: clean, removed, errors: check.ok ? [] : check.errors };
}
// The innermost array element a JSON pointer passes through, e.g. /output/fields/3/ref.
function lastListEntry(doc, path) {
  let value = doc,
    at = null;
  for (const key of path.split('/').slice(1)) {
    if (Array.isArray(value) && /^\d+$/.test(key) && Number(key) < value.length)
      at = { list: value, index: Number(key) };
    value = value?.[key];
    if (value === undefined) break;
  }
  return at;
}

/** Artifact version n is document version V1.(n-1); later versions are logged. */
export function stampVersion(draft, version, kind) {
  const doc = structuredClone(draft);
  const label = 'V1.' + (version - 1);
  doc.doc.version = label;
  if (!doc.doc.change_log.some((c) => c.version === label))
    doc.doc.change_log.push({
      version: label,
      date: today(),
      content: kind === 'FSD' ? '编制正式 FSD' : '按反馈修订方案',
    });
  return doc;
}
