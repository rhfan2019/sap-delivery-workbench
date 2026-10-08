// Incremental SSE framing shared by the browser and provider adapters.
export function createSseParser(maxFrameChars = 262144) {
  let buffer = '',
    data = [],
    event = '',
    id = '',
    frameSize = 0,
    skipLf = false;
  function push(text) {
    if (skipLf && text.length) {
      if (text.startsWith('\n')) text = text.slice(1);
      skipLf = false;
    }
    buffer += text;
    const frames = [];
    for (;;) {
      const index = buffer.search(/[\r\n]/);
      if (index < 0) break;
      skipLf = buffer[index] === '\r' && index === buffer.length - 1;
      const line = buffer.slice(0, index);
      const width = buffer[index] === '\r' && buffer[index + 1] === '\n' ? 2 : 1;
      buffer = buffer.slice(index + width);
      frameSize += line.length;
      if (frameSize > maxFrameChars) throw new Error('流式事件超过大小上限。');
      if (!line) {
        if (data.length) frames.push({ event: event || 'message', data: data.join('\n'), id });
        data = [];
        event = '';
        id = '';
        frameSize = 0;
      } else if (!line.startsWith(':')) {
        const colon = line.indexOf(':');
        const field = colon < 0 ? line : line.slice(0, colon);
        let value = colon < 0 ? '' : line.slice(colon + 1);
        if (value.startsWith(' ')) value = value.slice(1);
        if (field === 'data') data.push(value);
        if (field === 'event') event = value;
        if (field === 'id') id = value;
      }
    }
    if (buffer.length + frameSize > maxFrameChars) throw new Error('流式事件超过大小上限。');
    return frames;
  }
  function finish() {
    if (buffer.trim() || data.length) throw new Error('流式事件未完整结束。');
  }
  return { push, finish };
}
