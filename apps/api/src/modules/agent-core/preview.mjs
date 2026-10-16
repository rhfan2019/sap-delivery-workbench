// What the interface shows of a tool result: a few rows of a query, the objects a search
// found, a readable error, or the first lines of text. The model still sees the full result.
const ROWS = 5,
  OBJECTS = 8,
  TEXT = 600;

function parse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function cell(value) {
  return value == null ? '' : String(value).slice(0, 80);
}

// SAP errors arrive as `SAP 查询失败：{"error":"…; type: …; localizedMessage: …"}`.
function readableError(text) {
  const json = parse(text.slice(text.indexOf('{')));
  const raw = String(json?.error ?? text);
  const localized = raw.match(/localizedMessage:\s*([^;]+)/);
  const prefix = text.includes('{') ? text.slice(0, text.indexOf('{')).trim() : '';
  const join = prefix && !/[:：]$/.test(prefix) ? prefix + ' ' : prefix;
  return (join + (localized?.[1] ?? raw.split(';')[0])).slice(0, TEXT);
}

export function previewToolResult(status, content) {
  const text = String(content ?? '');
  if (status !== 'ok') return { kind: 'error', text: readableError(text) };
  const json = text.trimStart().startsWith('{') ? parse(text) : null;
  const result = json?.result;
  if (Array.isArray(result?.columns) && Array.isArray(result?.values)) {
    const columns = result.columns.map((c) => String(c.name ?? c)).slice(0, 12);
    return {
      kind: 'table',
      columns,
      rows: result.values.slice(0, ROWS).map((row) => columns.map((c) => cell(row?.[c]))),
      total: result.values.length,
    };
  }
  if (Array.isArray(json?.results))
    return {
      kind: 'objects',
      items: json.results.slice(0, OBJECTS).map((o) => ({
        name: cell(o['adtcore:name'] ?? o.name),
        type: cell(o['adtcore:type'] ?? o.type),
        description: cell(o['adtcore:description'] ?? o.description),
      })),
      total: json.results.length,
    };
  return { kind: 'text', text: text.slice(0, TEXT) };
}
