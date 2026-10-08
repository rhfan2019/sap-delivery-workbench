import { parseDraft, sha256 } from './specification.mjs';
import { renderConsultantMarkdown } from '@sap-delivery-workbench/contracts/agent-runtime/markdown';
import { validateSpecContract } from '@sap-delivery-workbench/contracts/agent-runtime/validator';
import {
  validDocument,
  renderDocument,
} from '@sap-delivery-workbench/contracts/item-workspace';

export const isRenderRequest = (text) =>
  /(?:JSON|结构化|已有|这个|上述).*(?:Markdown|\bMD\b)|(?:转换|导出).*(?:Markdown|\bMD\b)/i.test(
    text,
  ) && !/(?:修改|增加|删除|更新).*(?:规则|字段|口径|范围)/.test(text);

export function selectRenderSource(state) {
  for (const m of [...(state?.history ?? [])].reverse()) {
    if (m.role !== 'assistant' || m.status !== 'completed') continue;
    if (m.artifact?.spec) return JSON.stringify(m.artifact.spec);
    if (/^\s*(?:```json\s*)?\{/.test(m.content)) return m.content;
  }
  return state?.latestArtifact?.spec ? JSON.stringify(state.latestArtifact.spec) : null;
}

const labels = {
  title: '标题',
  riceType: '开发类型',
  businessGoal: '业务目标',
  scope: '业务范围',
  inScope: '包含范围',
  outOfScope: '不包含范围',
  rules: '业务规则',
  fields: '字段',
  tests: '测试',
  issues: '待确认事项',
  systemContext: '系统背景',
  requirements: '需求',
  description: '说明',
  name: '名称',
  value: '内容',
  status: '状态',
  sources: '来源',
};
const escape = (s) =>
  String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]);
export function renderTechnicalOutput(text) {
  const spec = parseDraft(text);
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new Error('需要完整JSON对象');
  const contractValid = validateSpecContract(spec).valid;
  let markdown;
  if (contractValid) markdown = renderConsultantMarkdown(spec);
  else if (validDocument(spec, 'development')) markdown = renderDocument(spec);
  else {
    const lines = [
      '# 结构化内容阅读稿',
      '',
      '> 仅转换原始内容，未通过正式成果合同校验；不代表已核验或采用。',
      '',
    ];
    function walk(value, depth = 2) {
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item && typeof item === 'object') {
            lines.push('');
            walk(item, Math.min(depth + 1, 6));
          } else lines.push('- ' + escape(item ?? '未提供'));
        }
      } else if (value && typeof value === 'object') {
        for (const [key, item] of Object.entries(value)) {
          lines.push('', '#'.repeat(depth) + ' ' + escape(labels[key] ?? key), '');
          walk(item, Math.min(depth + 1, 6));
        }
      } else lines.push(escape(value ?? '未提供'));
    }
    walk(spec);
    markdown = lines.join('\n');
  }
  return { markdown, contractValid, sourceHash: sha256(spec), rendererVersion: '1.0.0' };
}

export function extractConfirmedAnswers(history, prompt) {
  const previous = [...history]
    .reverse()
    .find((m) => m.role === 'assistant' && m.status === 'completed');
  if (!previous) return [];
  // Exceptions or corrections must never be promoted to blanket confirmation.
  const acceptsRecommendations =
    /^(?:全部|都|所有)(?:采用|按|接受)(?:推荐|建议)(?:方案)?[。！!，,\s]*(?:(?:请)?生成(?:FSD|功能说明书|说明书|草稿)[。！!\s]*)?$/i.test(
      prompt.trim(),
    );
  const legacyQuestions = [
    ...(previous.content ?? '').matchAll(
      /^\s*#{1,6}\s*问题\s*(\d+)\s*[：:]\s*([^\n]+)\n([\s\S]*?)(?=^\s*#{1,6}\s|$(?![\s\S]))/gm,
    ),
  ];
  if (acceptsRecommendations && !previous.decision && legacyQuestions.length) {
    return legacyQuestions.flatMap((m) => {
      const suggestions = [...m[3].matchAll(/^\s*(?:\*\*)?建议[：:](?:\*\*)?\s*([^\n]+)$/gm)];
      if (suggestions.length !== 1) return [];
      return [
        {
          question: m[2].trim(),
          factKey: sha256(m[2].trim()),
          questionId: 'legacy-q' + m[1],
          questionVersion: sha256(m[0]),
          label: suggestions[0][1].trim(),
          value: 'recommended',
          description: '仅确认该编号问题的明确建议，不确认其他段落或整份规格。',
          sourceMessageId: previous.id,
          sourceQuote: prompt,
          status: 'consultant_confirmed',
        },
      ];
    });
  }
  if (acceptsRecommendations && previous.decision) {
    return previous.decision.questions.flatMap((q) => {
      const recommended = q.options.filter((o) => o.recommended === true);
      if (recommended.length !== 1) return [];
      const o = recommended[0];
      return [
        {
          question: q.title,
          factKey: sha256(q.title),
          questionId: q.id,
          decisionId: previous.decision.id,
          label: o.label,
          value: o.value,
          description: o.description,
          sourceMessageId: previous.id,
          sourceQuote: prompt,
          status: 'consultant_confirmed',
        },
      ];
    });
  }
  const questions =
    previous.decision?.questions?.map((q) => q.title) ??
    (legacyQuestions.length ? legacyQuestions.map((m) => m[2].trim()) : null) ??
    [...previous.content.matchAll(/^\s*\d+[.、]\s*(.+)$/gm)].map((m) =>
      m[1].replace(/\*\*/g, '').trim(),
    );
  const parts = [...prompt.matchAll(/(?:^|[\n；;])\s*问题\s*(\d+)\s*[：:]\s*([^\n；;]+)/g)];
  const seen = new Set();
  return parts.flatMap((m) => {
    const n = Number(m[1]);
    if (!questions[n - 1] || seen.has(n)) return [];
    seen.add(n);
    return [
      {
        question: questions[n - 1],
        factKey: sha256(questions[n - 1]),
        label: m[2].trim(),
        value: 'free_text',
        description: '用户原文；仅确认此业务回答，不证明技术对象有效。',
        sourceMessageId: previous.id,
        sourceQuote: m[0].trim(),
        status: /不确定|未知/.test(m[2]) ? 'open' : 'consultant_confirmed',
      },
    ];
  });
}
