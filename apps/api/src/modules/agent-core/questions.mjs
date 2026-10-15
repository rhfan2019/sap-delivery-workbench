// Tool helpers and the ask_user tool shared by every agent: a batch of decisions only the
// user can make; the turn ends once it is asked.
export const fn = (name, description, properties, required = Object.keys(properties)) => ({
  type: 'function',
  function: {
    name,
    description,
    parameters: { type: 'object', properties, required, additionalProperties: false },
  },
});
export const str = (description) => ({ type: 'string', description });

export const ASK_USER_TOOL = fn(
  'ask_user',
  '向用户提出一批只有客户才能决定的问题，然后结束本轮等待答复。每批最多 5 题。',
  {
    questions: {
      type: 'array',
      minItems: 1,
      maxItems: 5,
      items: {
        type: 'object',
        properties: {
          question: str('问题'),
          background: str('当前依据，以及该选择影响哪些功能行为'),
          options: {
            type: 'array',
            minItems: 2,
            maxItems: 4,
            items: {
              type: 'object',
              properties: { label: str('选项'), impact: str('选择后的处理方式与影响') },
              required: ['label', 'impact'],
              additionalProperties: false,
            },
          },
          recommended: str('推荐的选项（与某个选项的 label 一致）'),
          reason: str('推荐理由'),
          why_customer: str('为什么这必须由客户决定、为什么查系统得不到'),
        },
        required: ['question', 'background', 'options', 'recommended', 'reason', 'why_customer'],
        additionalProperties: false,
      },
    },
  },
);

export function validateQuestions(questions) {
  if (!Array.isArray(questions) || questions.length < 1) return '至少提出一个问题。';
  if (questions.length > 5) return '每批最多 5 题，请只问最影响设计的问题，其余下一批再问。';
  for (const [i, q] of questions.entries()) {
    for (const key of ['question', 'background', 'recommended', 'reason', 'why_customer'])
      if (typeof q?.[key] !== 'string' || !q[key].trim()) return `第 ${i + 1} 题缺少 ${key}。`;
    if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 4)
      return `第 ${i + 1} 题需要 2～4 个选项。`;
    if (!q.options.some((o) => o?.label === q.recommended))
      return `第 ${i + 1} 题的推荐选项必须与某个选项一致。`;
  }
  return null;
}

// Answers to ask_user questions become the next user message, in plain words.
export function answersText(answers) {
  return (
    '对问题的答复：\n' +
    answers
      .map(
        (a, i) =>
          `${i + 1}. ${String(a.question ?? '').slice(0, 500)}\n   答复：${String(a.choice ?? '').slice(0, 500)}` +
          (a.note ? `\n   补充：${String(a.note).slice(0, 2000)}` : ''),
      )
      .join('\n')
  );
}
