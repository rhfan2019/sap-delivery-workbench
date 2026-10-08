import { failure } from '../../platform/auth.mjs';
import { text, choice, date, uuid } from '../admin/validation.mjs';
import sanitizeHtml from 'sanitize-html';
export const columns = {
  name: 'name',
  module: 'module',
  kind: 'kind',
  changeType: 'change_type',
  priority: 'priority',
  businessOwnerId: 'business_owner_id',
  developerId: 'developer_id',
  testerId: 'tester_id',
  plannedFsDate: 'planned_fs_date',
  plannedDevDate: 'planned_dev_date',
  plannedTestDate: 'planned_test_date',
  summary: 'summary',
  summaryFormat: 'summary_format',
  acceptance: 'acceptance',
  notes: 'notes',
  blockedReason: 'blocked_reason',
};
export const sectionKeys = [
  'background',
  'scope',
  'inputs',
  'rules',
  'outputs',
  'authorization',
  'exceptions',
  'acceptance',
  'cases',
];
export function fields(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !Object.keys(input).length)
    throw failure(400, '请提供要修改的字段。');
  const result = {};
  if ('summaryFormat' in input && !('summary' in input))
    throw failure(400, '修改需求格式时必须同时提交需求描述。');
  for (const [key, value] of Object.entries(input)) {
    if (!columns[key]) throw failure(400, '不允许修改该字段：' + key);
    if (['businessOwnerId', 'developerId', 'testerId'].includes(key))
      result[key] = value ? uuid(value) : null;
    else if (key.endsWith('Date')) result[key] = date(value);
    else if (key === 'summaryFormat') result[key] = choice(value, ['plain', 'html'], '需求格式');
    else if (key === 'kind')
      result[key] = choice(
        value,
        ['function', 'interface', 'report', 'enhancement', 'form'],
        '类型',
      );
    else if (key === 'changeType')
      result[key] = choice(value, ['new', 'optimize', 'rebuild'], '变更性质');
    else if (key === 'priority') result[key] = choice(value, ['high', 'medium', 'low'], '优先级');
    else
      result[key] = text(
        value,
        key === 'name' ? '开发名称' : key === 'module' ? '模块' : '内容',
        key === 'name' ? 200 : key === 'module' ? 32 : key === 'summary' ? 100000 : 10000,
        { optional: !['name', 'module'].includes(key) },
      );
  }
  if (input.summaryFormat === 'html')
    result.summary = sanitizeHtml(result.summary, {
      allowedTags: [
        'p',
        'br',
        'strong',
        'em',
        's',
        'u',
        'h2',
        'h3',
        'ul',
        'ol',
        'li',
        'blockquote',
        'pre',
        'code',
        'table',
        'thead',
        'tbody',
        'tr',
        'th',
        'td',
        'hr',
      ],
      allowedAttributes: { ol: ['start'], td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan'] },
      allowedSchemes: [],
    });
  return result;
}
export async function validatePeople(db, org, project, data) {
  for (const key of ['businessOwnerId', 'developerId', 'testerId']) {
    if (!data[key]) continue;
    const r = await db.query(
      `SELECT 1 FROM app.project_member pm JOIN app.organization_member om USING(organization_id,user_id)
      JOIN app.app_user u ON u.id=pm.user_id WHERE pm.organization_id=$1 AND pm.project_id=$2 AND pm.user_id=$3
      AND pm.status='active' AND om.status='active' AND u.status='active'`,
      [org, project, data[key]],
    );
    if (!r.rowCount) throw failure(400, '责任人必须是当前项目的有效成员。');
  }
}
export function fsInput(body) {
  if (!body?.sections || typeof body.sections !== 'object' || Array.isArray(body.sections))
    throw failure(400, 'FS 章节格式无效。');
  if (Object.keys(body.sections).some((k) => !sectionKeys.includes(k)))
    throw failure(400, 'FS 章节无效。');
  const sections = {};
  for (const key of sectionKeys)
    sections[key] = text(body.sections[key], 'FS章节', 30000, { optional: true });
  return { fsNumber: text(body.fsNumber, 'FS编号', 100, { optional: true }), sections };
}
