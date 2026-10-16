import { applyEdit, splitSections } from '../document.mjs';
import { checkDocument, formatCheck } from './check.mjs';
import { fn, str, ASK_USER_TOOL, validateQuestions } from '../../agent-core/public.mjs';

export { validateQuestions };

export const WORKSPACE_TOOLS = [
  fn(
    'read_document',
    '读取当前 FSD 文档。不给 section 时返回全文；给 section 时只返回标题包含该文字的章节。',
    { section: str('可选，章节标题中的文字，例如“2.4 输出布局”') },
    [],
  ),
  fn(
    'write_document',
    '写入 FSD。mode=replace 用 content 替换整份文档（初稿或整体重写）；mode=append 把 content 接在文档末尾（一次写不完时续写）。必须用 changes 说明本次写了或改了哪些章节。',
    {
      mode: { type: 'string', enum: ['replace', 'append'] },
      content: str('Markdown 正文'),
      changes: {
        type: 'array',
        description: '本次修改说明，每项一个章节',
        items: {
          type: 'object',
          properties: { section: str('章节标题'), summary: str('改了什么、为什么') },
          required: ['section', 'summary'],
          additionalProperties: false,
        },
      },
    },
  ),
  fn(
    'edit_document',
    '把文档中唯一的一段原文替换为新文本，用于局部修订。原文必须与文档完全一致且只出现一次。',
    {
      old_text: str('要替换的原文，需足够长以保证唯一'),
      new_text: str('替换后的文本'),
      reason: str('修改理由'),
      comment_id: str('对应的批注编号；不是因批注修改时留空'),
    },
    ['old_text', 'new_text', 'reason'],
  ),
  fn(
    'check_document',
    '检查章节完整性、表格结构、章节引用、附录 D 测试案例，并到 SAP 核实文中的表、字段和测试单据号。',
    {},
    [],
  ),
  ASK_USER_TOOL,
  fn('reply_comment', '回复用户的一条批注，说明改了什么，或不改的理由、反问。', {
    comment_id: str('批注编号'),
    reply: str('回复内容'),
  }),
];

// Working state of one turn: the document being edited and what the model declared.
export function createWorkspace({
  markdown = '',
  comments = [],
  verifyTable,
  seenInSap,
  ignoreRefs,
  verifiedBetween,
  onDocument,
  onReply,
}) {
  const state = { markdown, declarations: [], changed: false, questions: null };
  const commentIds = new Set(comments.map((c) => c.id));
  async function check() {
    if (!state.markdown.trim()) return '文档为空。';
    return formatCheck(
      await checkDocument(state.markdown, { verifyTable, seenInSap, ignoreRefs, verifiedBetween }),
    );
  }
  const handlers = {
    async read_document({ section } = {}) {
      if (!state.markdown.trim()) return '当前还没有文档。';
      if (!section) return state.markdown;
      const found = splitSections(state.markdown).filter((s) => s.heading.includes(section));
      return found.length
        ? found.map((s) => `${'#'.repeat(s.level)} ${s.heading}\n${s.body}`).join('\n\n')
        : `没有标题包含“${section}”的章节。`;
    },
    async write_document({ mode, content, changes }) {
      if (typeof content !== 'string' || !content.trim()) throw new Error('content 不能为空。');
      if (!Array.isArray(changes) || !changes.length)
        throw new Error('请用 changes 说明本次写了哪些章节。');
      state.markdown =
        mode === 'append'
          ? state.markdown.replace(/\s*$/, '\n\n') + content.trim() + '\n'
          : content.trim() + '\n';
      state.declarations.push({
        tool: 'write_document',
        mode,
        // Headings in appended text are declared by the append itself.
        sections: [
          ...changes.map((c) => String(c.section)),
          ...(mode === 'append'
            ? splitSections(content)
                .map((s) => s.heading)
                .filter(Boolean)
            : []),
        ],
        summary: changes,
      });
      state.changed = true;
      onDocument?.(state.markdown);
      return `已写入（${mode === 'append' ? '续写' : '整份'}，当前 ${state.markdown.length} 字符）。\n${await check()}`;
    },
    async edit_document({ old_text, new_text, reason, comment_id }) {
      if (typeof new_text !== 'string') throw new Error('new_text 必须是文本。');
      if (!reason?.trim()) throw new Error('请说明修改理由。');
      if (comment_id && !commentIds.has(comment_id)) throw new Error('批注编号不存在。');
      const result = applyEdit(state.markdown, old_text, new_text);
      state.markdown = result.markdown;
      state.declarations.push({
        tool: 'edit_document',
        sections: result.sections,
        reason,
        commentId: comment_id || null,
        before: old_text.slice(0, 2000),
        after: new_text.slice(0, 2000),
      });
      state.changed = true;
      onDocument?.(state.markdown);
      return `已修改（章节：${result.sections.join('、') || '文首'}）。\n${await check()}`;
    },
    check_document: () => check(),
    async ask_user({ questions }) {
      const problem = validateQuestions(questions);
      if (problem) throw new Error(problem);
      state.questions = questions;
      return '问题已发给用户，本轮结束，等待答复。';
    },
    async reply_comment({ comment_id, reply }) {
      if (!commentIds.has(comment_id)) throw new Error('批注编号不存在。');
      if (!reply?.trim()) throw new Error('回复不能为空。');
      await onReply?.(comment_id, reply.trim());
      return '已回复批注。';
    },
  };
  return { state, handlers };
}
