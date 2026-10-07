export function parseReportCases(source) {
  const lines = source
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .split('\n');
  const cases = [];
  let module, current;
  for (const line of lines) {
    const section = line.match(/^###\s+.*?\b(MM|SD|PP|FICO)\s*模块/);
    if (section) {
      module = section[1];
      current = null;
      continue;
    }
    const heading = line.match(/^####\s*案例(\d+)：(.+?)(?:（(.+)）)?\s*$/);
    if (heading) {
      if (!module) throw new Error('案例缺少模块');
      current = {
        module,
        number: Number(heading[1]),
        name: heading[2],
        originalKind: heading[3] ?? '',
        lines: [],
      };
      cases.push(current);
      continue;
    }
    if (current) current.lines.push(line);
    else if (line.trim()) throw new Error('未识别的文件内容');
  }
  const keys = new Set();
  return cases.map(({ lines, ...c }) => {
    const key = c.module + '-' + String(c.number).padStart(2, '0'),
      summary = lines.join('\n').trim();
    if (keys.has(key) || !summary) throw new Error('案例重复或需求为空：' + key);
    keys.add(key);
    return { ...c, key, summary };
  });
}
export function requirementHtml(text) {
  const escape = (s) =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  return text
    .split('\n')
    .map((line) => '<p>' + escape(line) + '</p>')
    .join('');
}
