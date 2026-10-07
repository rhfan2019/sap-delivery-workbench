import { parseResponseObject } from './response-json.mjs';
import { randomUUID } from 'node:crypto';
import { failure } from '../auth.mjs';
export function typeDecision(type) {
  return {
    id: randomUUID(),
    kind: 'type',
    message:
      type.supported && !type.riceType
        ? '请选择本次任务类型，确认后继续。'
        : '当前仅支持生成报表说明书；其他类型可以继续需求讨论。',
    questions: [
      {
        id: 'type',
        title: '接下来怎样处理？',
        options: [
          {
            value: 'R',
            label: '报表：生成说明书',
            description: '列表、筛选、汇总等只读展示需求。',
          },
          {
            value: 'dialogue',
            label: '继续需求讨论',
            description: '接口、迁移、增强或尚不确定：先梳理需求，不宣称已生成说明书。',
          },
        ],
      },
    ],
  };
}
export function modelDecision(text, answered = []) {
  let v;
  try {
    v = parseResponseObject(text);
  } catch {
    return null;
  }
  if (v?.kind !== 'clarification') return null;
  const qs = v.questions;
  if (!Array.isArray(qs) || !qs.length || qs.length > 3)
    throw failure(422, '澄清问题格式无效，未保存说明书。');
  const questions = qs.map((q, i) => {
    if (
      typeof q.title !== 'string' ||
      !q.title.trim() ||
      q.title.length > 500 ||
      !Array.isArray(q.options) ||
      q.options.length < 2 ||
      q.options.length > 4
    )
      throw failure(422, '澄清选项格式无效，未保存说明书。');
    return {
      id: 'q' + (i + 1),
      title: q.title,
      options: q.options.map((o, j) => {
        if (
          typeof o.label !== 'string' ||
          !o.label.trim() ||
          o.label.length > 200 ||
          typeof o.description !== 'string' ||
          o.description.length > 500
        )
          throw failure(422, '澄清选项内容无效。');
        return {
          value: 'o' + (j + 1),
          label: o.label,
          description: o.description,
          recommended: o.recommended === true,
        };
      }),
      allowText: true,
    };
  });
  const normalized = (value) =>
    value
      .normalize('NFKC')
      .replace(/[\s\p{P}]/gu, '')
      .toLowerCase();
  const prior = new Set(answered.map((a) => normalized(a.question)));
  const pending = questions.filter((q) => !prior.has(normalized(q.title)));
  if (!pending.length) return null;
  return {
    id: randomUUID(),
    kind: 'business',
    message: '需要确认以下业务口径。原需求与附件已保留，确认后继续。',
    questions: pending,
  };
}
export function answerDecision(decision, answer) {
  if (!decision || answer?.decisionId !== decision.id)
    throw failure(409, '问题已变化，请刷新后确认。');
  if (!answer.values || Object.keys(answer.values).length !== decision.questions.length)
    throw failure(400, '请回答全部问题。');
  return decision.questions.map((q) => {
    const value = answer.values[q.id],
      o = q.options.find((o) => o.value === value);
    if (
      !o &&
      !(
        q.allowText &&
        typeof value === 'string' &&
        value.startsWith('text:') &&
        value.slice(5).trim() &&
        value.length <= 1000
      )
    )
      throw failure(400, '请选择有效选项或补充说明。');
    return {
      decisionId: decision.id,
      questionId: q.id,
      status: /暂不确定|未知|待确认/.test(o?.label ?? value) ? 'open' : 'consultant_confirmed',
      question: q.title,
      value,
      label: o?.label ?? value.slice(5),
      description: o?.description ?? '',
    };
  });
}
