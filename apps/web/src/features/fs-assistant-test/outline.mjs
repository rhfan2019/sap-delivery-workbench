export function createOutline(headings, prefix = 'fsd') {
  const stack = [];
  return headings.map((heading, index) => {
    while (stack.length && stack.at(-1).level >= heading.level) stack.pop();
    const item = {
      id: `${prefix}-section-${index + 1}`,
      label: heading.text.trim() || '未命名章节',
      level: heading.level,
      depth: stack.length,
      parentId: stack.at(-1)?.id ?? null,
    };
    stack.push(item);
    return item;
  });
}
export function visibleOutline(headings, collapsed) {
  const hidden = new Set();
  return headings.filter((item) => {
    const hide = item.parentId && (collapsed.has(item.parentId) || hidden.has(item.parentId));
    if (hide) hidden.add(item.id);
    return !hide;
  });
}
