// Pure mapping between the agent APIs and the conversation components.

const TOOL_LABELS = {
  searchObject: '搜索 SAP 对象',
  findObjectPath: '定位 SAP 对象',
  objectTypes: '读取对象类型',
  ddicElement: '读取表结构',
  ddicRepositoryAccess: '读取数据字典',
  tableContents: '读取表内容',
  runQuery: '查询表内容或配置',
  getObjectSource: '读取源码',
  objectStructure: '读取对象结构',
  classComponents: '读取类组件',
  findDefinition: '查找定义',
  usageReferences: '查找使用位置',
  abapDocumentation: '读取 ABAP 文档',
  read_document: '读取文档',
  write_document: '编写文档',
  edit_document: '修改文档',
  check_document: '自动校验文档',
  list_materials: '查看资料清单',
  read_material: '读取资料',
  read_artifact: '读取方案或代码',
  write_artifact: '编写方案或代码',
  edit_artifact: '修改方案或代码',
  import_code: '保存上传的代码',
  sync_from_sap: '从 SAP 同步代码',
  check_code: '校验代码',
  ask_user: '整理待确认问题',
  reply_comment: '回复批注',
};
export const toolLabel = (name) => TOOL_LABELS[name] ?? name;

export function stepFromToolCall(call, index = 0) {
  return {
    stepId: call.id ?? `${call.name}-${index}`,
    label: toolLabel(call.name),
    status: call.status === 'running' ? 'running' : call.status === 'ok' ? 'succeeded' : 'failed',
    attempt: 1,
    summary: call.summary ?? '',
    startedAt: call.createdAt ?? null,
    finishedAt: call.createdAt ?? null,
  };
}

export function decisionFromQuestions(id, questions) {
  return {
    id,
    kind: 'business',
    message: '以下问题需要客户决定，请选择后提交；也可以补充其他口径。',
    questions: questions.map((q, i) => ({
      id: 'q' + (i + 1),
      title: q.background ? `${q.question}（${q.background}）` : q.question,
      allowText: true,
      options: q.options.map((o) => ({
        value: o.label,
        label: o.label,
        description: o.impact,
        recommended: o.label === q.recommended,
      })),
    })),
  };
}

// DecisionCard values ({q1: label | 'text:...'}) back into answers for the API.
export function answersFromValues(questions, values) {
  return questions.map((q, i) => {
    const value = values['q' + (i + 1)] ?? '';
    return value.startsWith('text:')
      ? { question: q.question, choice: '其他', note: value.slice(5) }
      : { question: q.question, choice: value };
  });
}

const STATUS = {
  completed: 'completed',
  failed: 'failed',
  cancelled: 'cancelled',
  interrupted: 'failed',
};

// Rebuilds the visible conversation: one user message and one assistant message per turn.
// Saved versions are `documents` (FSD) or `versions` (development plan and code).
export function buildTimeline({
  messages = [],
  turns = [],
  toolCalls = [],
  documents = [],
  versions = [],
}) {
  const saved = [...documents, ...versions];
  const out = [];
  const lastTurn = turns.at(-1);
  for (const turn of turns) {
    const own = messages.filter((m) => m.turnId === turn.id);
    const user = own.find((m) => m.role === 'user');
    if (user)
      out.push({
        id: user.id,
        role: 'user',
        content: user.content,
        status: 'completed',
        createdAt: user.createdAt,
        authorName: user.authorName ?? null,
      });
    const asked = own.find((m) => m.role === 'tool' && m.payload?.questions?.length);
    const text = own
      .filter((m) => m.role === 'assistant' && m.content?.trim())
      .map((m) => m.content.trim())
      .join('\n\n');
    const next = turns[turns.indexOf(turn) + 1];
    const answers = next
      ? messages.find((m) => m.turnId === next.id && m.role === 'user')?.payload?.answers
      : undefined;
    const doc = saved.filter((d) => d.turnId === turn.id).sort((a, b) => b.version - a.version)[0];
    const waiting = !!asked && turn === lastTurn && turn.status === 'completed';
    out.push({
      id: 'turn-' + turn.id,
      role: 'assistant',
      runId: turn.id,
      content: text,
      status: waiting ? 'waiting_user' : (STATUS[turn.status] ?? 'completed'),
      model: turn.model?.name,
      createdAt: turn.startedAt,
      finishedAt: turn.finishedAt,
      steps: toolCalls
        .filter((c) => c.turnId === turn.id && c.name !== 'ask_user')
        .map((c, i) => stepFromToolCall(c, i)),
      ...(asked
        ? {
            decision: decisionFromQuestions(asked.id, asked.payload.questions),
            answers: answers?.map((a) => ({ question: a.question, label: a.choice })),
          }
        : {}),
      ...(doc
        ? { artifact: { id: 'v' + doc.version, revision: doc.version, comparison: doc.comparison } }
        : {}),
      ...(turn.status === 'failed' || turn.status === 'interrupted'
        ? {
            error:
              turn.error?.message ??
              (turn.status === 'interrupted'
                ? '服务重启，本轮已中断。可以重新发送消息继续。'
                : '本轮未完成。'),
            errorCode: turn.error?.code,
          }
        : {}),
    });
  }
  return out;
}

// The open question batch, if the latest turn ended by asking.
export function pendingQuestions(detail) {
  const turn = detail.turns?.at(-1);
  if (!turn || turn.status !== 'completed') return null;
  const asked = (detail.messages ?? []).find(
    (m) => m.turnId === turn.id && m.role === 'tool' && m.payload?.questions?.length,
  );
  return asked ? { id: asked.id, questions: asked.payload.questions } : null;
}
