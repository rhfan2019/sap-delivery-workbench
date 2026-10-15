import { fn, str, ASK_USER_TOOL, validateQuestions } from '../../agent-core/public.mjs';
import {
  applyEdit,
  bareCode,
  diffLines,
  formatDiff,
  lineOf,
  readCodeLines,
  readPlanSection,
} from '../artifacts.mjs';
import { checkCode, formatCheck } from './check.mjs';
import { materialList } from '../materials.mjs';

const target = {
  type: 'string',
  enum: ['plan', 'code'],
  description: 'plan = 开发方案（Markdown）；code = 代码（ABAP 源码）',
};

export const WORKSPACE_TOOLS = [
  fn(
    'list_materials',
    '列出本开发项可用的资料：开发清单信息、FSD 各版本、开发项文件、对话附件、框架类，并标出相对当前版本依据的新增与变化。',
    {},
    [],
  ),
  fn(
    'read_material',
    '读取一份资料。FSD 可用 section 只读标题包含该文字的章节。',
    {
      key: str('资料编号，来自 list_materials'),
      section: str('可选，FSD 章节标题中的文字'),
    },
    ['key'],
  ),
  fn(
    'read_artifact',
    '读取当前开发方案或代码。开发方案可按章节读；代码按行范围读，每次最多 400 行，带行号。',
    {
      target,
      section: str('可选，开发方案章节标题中的文字'),
      start_line: { type: 'integer', description: '可选，代码起始行，默认 1' },
      end_line: { type: 'integer', description: '可选，代码结束行' },
    },
    ['target'],
  ),
  fn(
    'write_artifact',
    '写入开发方案或代码。mode=replace 整体写入（初稿或重写）；mode=append 接在末尾续写（一次写不完时）。代码写源码本身，不加 Markdown 代码块标记。必须用 changes 说明写了什么。',
    {
      target,
      mode: { type: 'string', enum: ['replace', 'append'] },
      content: str('开发方案的 Markdown，或 ABAP 源码'),
      changes: {
        type: 'array',
        description: '本次修改说明。开发方案每项一个章节；代码每项一个部分（如方法名）',
        items: {
          type: 'object',
          properties: {
            section: str('开发方案的章节标题，或代码的部分名称'),
            summary: str('改了什么、为什么'),
          },
          required: ['section', 'summary'],
          additionalProperties: false,
        },
      },
    },
  ),
  fn(
    'edit_artifact',
    '把开发方案或代码中唯一的一段原文替换为新文本，用于局部修订。原文必须完全一致且只出现一次。',
    {
      target,
      old_text: str('要替换的原文，需足够长以保证唯一'),
      new_text: str('替换后的文本'),
      reason: str('修改理由'),
      comment_id: str('对应的批注编号；不是因批注修改时留空'),
    },
    ['target', 'old_text', 'new_text', 'reason'],
  ),
  fn(
    'import_code',
    '把用户确认为“修改后的代码”的对话附件保存为新版本（来源：开发顾问上传），返回与上一版本的差异。用途不明确时先问用户，不要调用。',
    {
      attachment_id: str('对话附件编号（资料编号 attachment: 之后的部分）'),
      reason: str('用户确认的依据'),
    },
  ),
  fn(
    'sync_from_sap',
    '从 SAP 读取本开发项程序对象的完整源码，保存为新版本（来源：SAP 同步），返回与上一版本的差异。开发清单登记了多个程序对象时用 object_name 指定。',
    { object_name: str('可选，程序名') },
    [],
  ),
  fn('check_code', '对当前代码运行一次完整的静态校验，并到 SAP 核实表和字段。', {}, []),
  fn(
    'reply_comment',
    '回复用户的一条批注，说明改了什么；不修改时把 no_change 设为 true，并说明理由或提出反问。批注针对的内容（代码或开发方案）本轮没有改动时，只能以 no_change 回复。',
    {
      comment_id: str('批注编号'),
      reply: str('回复内容'),
      no_change: { type: 'boolean', description: '本条批注不修改，只说明理由或反问' },
    },
    ['comment_id', 'reply'],
  ),
  ASK_USER_TOOL,
];

const INCLUDE = /^\s*INCLUDE\s+[\w/]+\s*\./im;

// Working state of one turn: the plan and the code being edited, and what the model
// declared. Hand-backs (import, SAP sync) are saved as versions at once through `onSave`.
export function createWorkspace({
  plan = '',
  code = '',
  comments = [],
  materials = [],
  programs = [],
  readMaterial,
  readProgram,
  verifyTable,
  onDraft,
  onReply,
  onSave,
}) {
  const state = {
    plan,
    code,
    base: { plan, code },
    declarations: [],
    changed: false,
    questions: null,
  };
  const commentTargets = new Map(comments.map((c) => [c.id, c.target]));
  const commentIds = new Set(commentTargets.keys());
  const check = async () =>
    formatCheck(await checkCode(state.code, { plan: state.plan, verifyTable }));

  async function handBack(newCode, source, sourceRef, note) {
    const diff = formatDiff(diffLines(state.code, newCode));
    const version = await onSave({ plan: state.plan, code: newCode, source, sourceRef });
    state.code = newCode;
    state.base = { plan: state.plan, code: newCode };
    state.declarations = [];
    state.changed = false;
    onDraft?.('code', newCode);
    return `已保存为第 ${version} 版（共 ${newCode.split('\n').length} 行）。${note}\n与上一版本的差异：\n${diff}\n之后的修改都基于这一版本，不得把用户的手工修改改回去。`;
  }

  const handlers = {
    list_materials: () => materialList(materials) || '没有资料。',
    read_material: ({ key, section }) => readMaterial(key, section),
    read_artifact({ target: t, section, start_line, end_line } = {}) {
      if (t === 'plan') {
        if (!state.plan.trim()) return '当前还没有开发方案。';
        return section ? readPlanSection(state.plan, section) : state.plan;
      }
      if (t === 'code') {
        if (!state.code.trim()) return '当前还没有代码。';
        return readCodeLines(state.code, start_line, end_line);
      }
      throw new Error('target 必须是 plan 或 code。');
    },
    async write_artifact({ target: t, mode, content, changes }) {
      if (!['plan', 'code'].includes(t)) throw new Error('target 必须是 plan 或 code。');
      if (typeof content !== 'string' || !content.trim()) throw new Error('content 不能为空。');
      if (!Array.isArray(changes) || !changes.length)
        throw new Error('请用 changes 说明本次写了什么。');
      const text = t === 'code' ? bareCode(content).replace(/\s+$/, '') : content.trim();
      state[t] = mode === 'append' ? state[t].replace(/\s*$/, '\n') + text + '\n' : text + '\n';
      state.declarations.push({
        target: t,
        tool: 'write_artifact',
        mode,
        sections: changes.map((c) => String(c.section)),
        summary: changes,
      });
      state.changed = true;
      onDraft?.(t, state[t]);
      const size =
        t === 'code' ? `${state.code.split('\n').length} 行` : `${state.plan.length} 字符`;
      return `已写入${t === 'plan' ? '开发方案' : '代码'}（${mode === 'append' ? '续写' : '整份'}，当前 ${size}）。${t === 'code' ? '\n' + (await check()) : ''}`;
    },
    async edit_artifact({ target: t, old_text, new_text, reason, comment_id }) {
      if (!['plan', 'code'].includes(t)) throw new Error('target 必须是 plan 或 code。');
      if (typeof new_text !== 'string') throw new Error('new_text 必须是文本。');
      if (!reason?.trim()) throw new Error('请说明修改理由。');
      if (comment_id && !commentIds.has(comment_id)) throw new Error('批注编号不存在。');
      const result = applyEdit(state[t], old_text, new_text);
      const line = lineOf(state[t], result.at);
      state[t] = result.text;
      const headings = (s) => [...s.matchAll(/^#{1,6}\s+(.*\S)\s*$/gm)].map((m) => m[1]);
      let section = '';
      if (t === 'plan')
        for (const m of state.plan.slice(0, result.at).matchAll(/^#{1,6}\s+(.*\S)\s*$/gm))
          section = m[1];
      state.declarations.push({
        target: t,
        tool: 'edit_artifact',
        sections:
          t === 'plan'
            ? [...new Set([section, ...headings(old_text), ...headings(new_text)])].filter(Boolean)
            : [],
        line,
        reason,
        commentId: comment_id || null,
        before: old_text.slice(0, 2000),
        after: new_text.slice(0, 2000),
      });
      state.changed = true;
      onDraft?.(t, state[t]);
      return `已修改${t === 'plan' ? '开发方案' : `代码（第 ${line} 行附近）`}。${t === 'code' ? '\n' + (await check()) : ''}`;
    },
    async import_code({ attachment_id, reason }) {
      if (!reason?.trim()) throw new Error('请说明用户确认的依据。');
      const m = materials.find((x) => x.key === `attachment:${attachment_id}`);
      if (!m) throw new Error('没有这个对话附件。');
      if (!m.text?.trim()) throw new Error('附件内容为空或未能读取。');
      const code = bareCode(m.text).replace(/\s+$/, '') + '\n';
      const note = INCLUDE.test(code)
        ? '\n注意：代码含 INCLUDE 语句。开发助手的代码是单份的，请向用户确认是否拆分过。'
        : '';
      return handBack(code, 'upload', m.label.replace(/^对话附件 /, ''), note);
    },
    async sync_from_sap({ object_name } = {}) {
      if (!programs.length)
        throw new Error(
          '开发清单尚未登记程序对象（R3TR PROG）。请告诉用户在开发清单中填写对象名后再同步。',
        );
      const wanted = object_name?.trim().toUpperCase();
      const name = wanted || (programs.length === 1 ? programs[0] : null);
      if (!name)
        throw new Error(`开发清单登记了多个程序：${programs.join('、')}，请用 object_name 指定。`);
      if (!programs.includes(name))
        throw new Error(`${name} 不是本开发项登记的程序对象（${programs.join('、')}）。`);
      let source;
      try {
        source = await readProgram(name);
      } catch (e) {
        throw new Error(`从 SAP 读取 ${name} 失败（SAP 中尚无此对象，或连接不可用）：${e.message}`);
      }
      if (!source?.trim()) throw new Error(`SAP 中 ${name} 的源码为空。`);
      const note = INCLUDE.test(source)
        ? '\n注意：源码含 INCLUDE 语句，未展开。开发助手的代码是单份的，请向用户确认是否拆分过。'
        : '';
      return handBack(
        source.replace(/\r\n/g, '\n').replace(/\s+$/, '') + '\n',
        'sap',
        `PROG ${name}`,
        note,
      );
    },
    check_code: () => (state.code.trim() ? check() : '当前还没有代码。'),
    async ask_user({ questions }) {
      const problem = validateQuestions(questions);
      if (problem) throw new Error(problem);
      state.questions = questions;
      return '问题已发给用户，本轮结束，等待答复。';
    },
    async reply_comment({ comment_id, reply, no_change }) {
      if (!commentIds.has(comment_id)) throw new Error('批注编号不存在。');
      if (!reply?.trim()) throw new Error('回复不能为空。');
      // A reply may only claim a change the program can see (decision 2.6).
      const target = commentTargets.get(comment_id);
      if (!no_change && target && state[target] === state.base[target])
        throw new Error(
          `这条批注针对${target === 'code' ? '代码' : '开发方案'}，但本轮${target === 'code' ? '代码' : '开发方案'}没有任何改动。请先用 edit_artifact 修改并关联批注编号；确实不修改时，把 no_change 设为 true 并说明理由。`,
        );
      await onReply?.(comment_id, reply.trim());
      return '已回复批注。';
    },
  };
  return { state, handlers };
}
