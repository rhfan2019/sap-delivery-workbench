export function resolveSchema(schema = {}, root = {}) {
  return schema.$ref?.startsWith('#/')
    ? (schema.$ref
        .slice(2)
        .split('/')
        .reduce((s, k) => s?.[k], root) ?? {})
    : schema;
}
export function newArrayItem(schema, root, document) {
  const itemSchema = resolveSchema(schema, root).items ?? {};
  const prefixByType = {
    source: 'SRC',
    requirement: 'REQ',
    rule: 'RULE',
    field: 'FIELD',
    sapObject: 'OBJ',
    issue: 'ISSUE',
    test: 'TEST',
    evidence: 'EVIDENCE',
  };
  const ids = new Set();
  function scan(v) {
    if (!v || typeof v !== 'object') return;
    if (typeof v.id === 'string') ids.add(v.id);
    Object.values(v).forEach(scan);
  }
  scan(document);
  function blank(raw, key = '') {
    const s = resolveSchema(raw, root);
    if (s.const !== undefined) return s.const;
    if (s.enum)
      return s.enum.includes('unverified')
        ? 'unverified'
        : s.enum.includes('open')
          ? 'open'
          : s.enum[0];
    if (Array.isArray(s.type) && s.type.includes('null')) return null;
    if (s.type === 'array') return [];
    if (s.type === 'object' || s.properties)
      return Object.fromEntries(
        (s.required ?? Object.keys(s.properties ?? {})).map((k) => [
          k,
          blank(s.properties?.[k] ?? {}, k),
        ]),
      );
    if (s.type === 'boolean') return false;
    if (s.type === 'number' || s.type === 'integer') return s.minimum ?? 0;
    if (key === 'id') {
      const prefix =
        /^\^([A-Z]+)-/.exec(s.pattern ?? '')?.[1] ??
        prefixByType[itemSchema.$ref?.split('/').at(-1)] ??
        'ITEM';
      if (prefix) {
        let n = 1;
        while (ids.has(prefix + '-' + String(n).padStart(3, '0'))) n++;
        return prefix + '-' + String(n).padStart(3, '0');
      }
    }
    return '';
  }
  return blank(resolveSchema(schema, root).items ?? {});
}
