const OLD_TOOL_RESULT_CHARS = 1500;

// Stored messages back into chat messages. Earlier turns keep tool results short; an
// interrupted turn's unanswered tool calls get placeholder results so the history stays valid.
export function historyMessages(stored) {
  const out = [];
  for (let i = 0; i < stored.length; i++) {
    const m = stored[i];
    if (m.role === 'user') out.push({ role: 'user', content: m.content });
    else if (m.role === 'assistant') {
      const calls = m.payload?.toolCalls ?? [];
      out.push({
        role: 'assistant',
        content: m.content || (calls.length ? null : ''),
        ...(calls.length
          ? {
              tool_calls: calls.map((c) => ({
                id: c.id,
                type: 'function',
                function: { name: c.name, arguments: c.arguments },
              })),
            }
          : {}),
      });
      const answered = new Set();
      for (let j = i + 1; j < stored.length && stored[j].role === 'tool'; j++) {
        const t = stored[j];
        answered.add(t.payload?.toolCallId);
        const content =
          t.content.length > OLD_TOOL_RESULT_CHARS
            ? t.content.slice(0, OLD_TOOL_RESULT_CHARS) + '\n…（较早的工具结果已截断）'
            : t.content;
        out.push({ role: 'tool', tool_call_id: t.payload?.toolCallId, content });
        i = j;
      }
      for (const c of calls)
        if (!answered.has(c.id))
          out.push({ role: 'tool', tool_call_id: c.id, content: '（未执行：上一轮已中断）' });
    }
  }
  return out;
}
