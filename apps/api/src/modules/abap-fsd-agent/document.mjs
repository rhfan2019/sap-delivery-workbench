// FSD documents are Markdown. Sections are keyed by their heading text so that
// versions can be compared and changes attributed without a line-level diff.
export function splitSections(markdown) {
  const sections = [];
  let current = { heading: '', level: 0, lines: [] };
  for (const line of markdown.split('\n')) {
    const match = /^(#{1,6})\s+(.*\S)\s*$/.exec(line);
    if (match) {
      sections.push(current);
      current = { heading: match[2], level: match[1].length, lines: [] };
    } else current.lines.push(line);
  }
  sections.push(current);
  return sections
    .filter((s) => s.heading || s.lines.some((l) => l.trim()))
    .map((s) => ({ heading: s.heading, level: s.level, body: s.lines.join('\n').trim() }));
}

// Heading of the section that contains character offset `index`.
export function sectionAt(markdown, index) {
  let heading = '';
  for (const match of markdown.slice(0, index).matchAll(/^#{1,6}\s+(.*\S)\s*$/gm))
    heading = match[1];
  return heading;
}

export function changedSections(before, after) {
  const map = (md) => new Map(splitSections(md).map((s) => [s.heading, s.body]));
  const a = map(before),
    b = map(after);
  const changed = [];
  for (const [heading, body] of b)
    if (!a.has(heading)) changed.push({ heading, change: 'added' });
    else if (a.get(heading) !== body) changed.push({ heading, change: 'modified' });
  for (const heading of a.keys()) if (!b.has(heading)) changed.push({ heading, change: 'removed' });
  return changed;
}

// Compares what the model declared with what actually changed between two versions.
// Each declaration names the sections it touched; edits record them automatically.
export function compareDeclarations(before, after, declarations) {
  const actual = changedSections(before, after);
  if (!before) return { actual, undeclared: [], unapplied: [] };
  const declared = new Set(declarations.flatMap((d) => d.sections ?? []));
  const touched = new Set(actual.map((c) => c.heading));
  return {
    actual,
    undeclared: actual.filter((c) => !declared.has(c.heading)).map((c) => c.heading),
    unapplied: [...declared].filter((h) => !touched.has(h)),
  };
}

// Replaces exactly one occurrence of `oldText`.
export function applyEdit(markdown, oldText, newText) {
  if (!oldText) throw new Error('原文不能为空。');
  const first = markdown.indexOf(oldText);
  if (first < 0) throw new Error('文档中找不到这段原文，请先用 read_document 读取最新内容。');
  if (markdown.indexOf(oldText, first + 1) >= 0)
    throw new Error('这段原文在文档中出现多次，请提供更长、唯一的原文。');
  const headings = (text) => [...text.matchAll(/^#{1,6}\s+(.*\S)\s*$/gm)].map((m) => m[1]);
  const sections = new Set([
    oldText.startsWith('#') ? '' : sectionAt(markdown, first),
    ...headings(oldText),
    ...headings(newText),
  ]);
  sections.delete('');
  return {
    markdown: markdown.slice(0, first) + newText + markdown.slice(first + oldText.length),
    sections: [...sections],
  };
}
