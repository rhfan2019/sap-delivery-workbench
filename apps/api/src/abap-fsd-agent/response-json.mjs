// Accept presentation wrappers, never repair or guess JSON content.
export function parseResponseObject(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 1048576)
    throw new SyntaxError('模型输出超过大小限制');
  let start = -1,
    end = -1,
    quoted = false,
    escaped = false;
  const stack = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') quoted = false;
      continue;
    }
    if (stack.length && c === '"') {
      quoted = true;
      continue;
    }
    if (c === '{' || c === '[') {
      if (!stack.length) {
        if (start !== -1 || c !== '{') throw new SyntaxError('需要唯一完整JSON对象');
        start = i;
      }
      stack.push(c);
    } else if (c === '}' || c === ']') {
      if (stack.pop() !== (c === '}' ? '{' : '[')) throw new SyntaxError('JSON括号不匹配');
      if (!stack.length) end = i + 1;
    }
  }
  if (start < 0 || end < 0 || stack.length || quoted) throw new SyntaxError('JSON未完整结束');
  return JSON.parse(text.slice(start, end));
}
