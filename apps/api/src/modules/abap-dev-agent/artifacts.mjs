// The two products of a session: the development plan (Markdown) and the code (one ABAP
// program). Sections key the plan; lines and text anchors key the code.

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

export function readPlanSection(plan, section) {
  const found = splitSections(plan).filter((s) => s.heading.includes(section));
  return found.length
    ? found.map((s) => `${'#'.repeat(s.level)} ${s.heading}\n${s.body}`).join('\n\n')
    : `没有标题包含“${section}”的章节。`;
}

export const MAX_READ_LINES = 400;

// Numbered lines so the model can refer back to them; at most MAX_READ_LINES per call.
export function readCodeLines(code, startLine = 1, endLine) {
  const lines = code.split('\n');
  const from = Math.max(1, Math.trunc(Number(startLine) || 1));
  const to = Math.min(
    lines.length,
    Math.trunc(Number(endLine) || lines.length),
    from + MAX_READ_LINES - 1,
  );
  if (from > lines.length) return `代码共 ${lines.length} 行，没有第 ${from} 行。`;
  const body = lines
    .slice(from - 1, to)
    .map((l, i) => `${String(from + i).padStart(5)}  ${l}`)
    .join('\n');
  return (
    `第 ${from}～${to} 行（共 ${lines.length} 行）：\n${body}` +
    (to < lines.length ? `\n…（还有 ${lines.length - to} 行，用 start_line=${to + 1} 继续读）` : '')
  );
}

// Classes, methods, forms and events with their lines: what the model sees of long code.
export function codeOutline(code) {
  const out = [];
  code.split('\n').forEach((line, i) => {
    const m =
      /^\s*(CLASS\s+\S+\s+(?:DEFINITION|IMPLEMENTATION)|METHOD\s+\S+|FORM\s+\S+|MODULE\s+\S+|INITIALIZATION|START-OF-SELECTION|AT\s+SELECTION-SCREEN[^.]*|END-OF-SELECTION)/i.exec(
        line,
      );
    if (m) out.push(`${String(i + 1).padStart(5)}  ${m[1].replace(/\s+/g, ' ')}`);
  });
  return out.join('\n');
}

// Models sometimes wrap code in Markdown fences; the stored code is the bare source.
export function bareCode(text) {
  const m = /^\s*```[a-zA-Z]*\s*\n([\s\S]*?)\n```\s*$/.exec(text);
  return (m ? m[1] : text).replace(/\r\n/g, '\n');
}

// Replaces exactly one occurrence of `oldText`.
export function applyEdit(text, oldText, newText) {
  if (!oldText) throw new Error('原文不能为空。');
  const first = text.indexOf(oldText);
  if (first < 0) throw new Error('找不到这段原文，请先用 read_artifact 读取最新内容。');
  if (text.indexOf(oldText, first + 1) >= 0)
    throw new Error('这段原文出现多次，请提供更长、唯一的原文。');
  return { text: text.slice(0, first) + newText + text.slice(first + oldText.length), at: first };
}

export const lineOf = (text, index) => text.slice(0, index).split('\n').length;

// Line diff for review and hand-back. Common head and tail are trimmed; the middle is
// compared by longest common subsequence while small enough, otherwise shown as replaced.
export function diffLines(before, after, { context = 2, maxCells = 4_000_000 } = {}) {
  const a = before ? before.split('\n') : [],
    b = after ? after.split('\n') : [];
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  )
    tail++;
  const x = a.slice(head, a.length - tail),
    y = b.slice(head, b.length - tail);
  const ops = []; // [type, lineA, lineB, text]
  if (x.length * y.length <= maxCells) {
    const n = x.length,
      m = y.length;
    const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        lcs[i][j] = x[i] === y[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    let i = 0,
      j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && x[i] === y[j]) ops.push([' ', head + ++i, head + ++j, x[i - 1]]);
      else if (i < n && (j >= m || lcs[i + 1][j] >= lcs[i][j + 1]))
        ops.push(['-', head + ++i, null, x[i - 1]]);
      else ops.push(['+', null, head + ++j, y[j - 1]]);
    }
  } else {
    x.forEach((t, k) => ops.push(['-', head + k + 1, null, t]));
    y.forEach((t, k) => ops.push(['+', null, head + k + 1, t]));
  }
  const added = ops.filter((o) => o[0] === '+').length,
    removed = ops.filter((o) => o[0] === '-').length;
  // Hunks: changed lines with `context` unchanged lines around them.
  const hunks = [];
  let current = null;
  ops.forEach((op, k) => {
    if (op[0] === ' ') return;
    const from = Math.max(0, k - context),
      to = Math.min(ops.length - 1, k + context);
    if (current && from <= current.to + 1) current.to = to;
    else hunks.push((current = { from, to }));
  });
  return {
    added,
    removed,
    hunks: hunks.map(({ from, to }) => {
      const lines = ops.slice(from, to + 1);
      const first = lines.find((o) => o[2]) ?? lines[0];
      return {
        newStart: first[2] ?? first[1] ?? head + 1,
        lines: lines.map(([t, , , s]) => `${t} ${s}`),
      };
    }),
  };
}

export function formatDiff(diff, { maxLines = 300 } = {}) {
  if (!diff.added && !diff.removed) return '与上一版本相同。';
  const out = [`新增 ${diff.added} 行，删除 ${diff.removed} 行。`];
  let budget = maxLines;
  for (const h of diff.hunks) {
    if (budget <= 0) {
      out.push('…（差异过长已截断；需要时用 read_artifact 按行读取当前代码）');
      break;
    }
    out.push(`@@ 新版第 ${h.newStart} 行附近`);
    out.push(...h.lines.slice(0, budget));
    budget -= h.lines.length;
  }
  return out.join('\n');
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

// What the model declared against what actually changed (decision 2.6). The plan is
// compared by section; the code by changed line count against declared edits.
export function compareDeclarations(before, after, declarations) {
  const planDeclared = new Set(
    declarations.filter((d) => d.target === 'plan').flatMap((d) => d.sections ?? []),
  );
  const planActual = changedSections(before.plan, after.plan);
  const touched = new Set(planActual.map((c) => c.heading));
  const code = diffLines(before.code, after.code);
  const codeDeclared = declarations.some((d) => d.target === 'code');
  return {
    plan: {
      actual: planActual,
      undeclared: before.plan
        ? planActual.filter((c) => !planDeclared.has(c.heading)).map((c) => c.heading)
        : [],
      unapplied: [...planDeclared].filter((h) => before.plan && !touched.has(h)),
    },
    code: {
      added: code.added,
      removed: code.removed,
      undeclared: (code.added || code.removed) && !codeDeclared,
    },
  };
}

// Open comments whose anchor text no longer appears in the new version become stale.
export function staleComments(comments, artifacts) {
  return comments
    .filter((c) => c.status === 'open' && !(artifacts[c.target] ?? '').includes(c.anchorText))
    .map((c) => c.id);
}
