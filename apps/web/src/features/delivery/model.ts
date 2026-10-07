import { requirementText } from './richText';
export interface Item {
  id: string;
  code: string;
  stage: string;
  rowVersion: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  name: string;
  module: string;
  kind: string;
  changeType: string;
  priority: string;
  businessOwnerId: string | null;
  developerId: string | null;
  testerId: string | null;
  plannedFsDate: string | null;
  plannedDevDate: string | null;
  plannedTestDate: string | null;
  summary: string | null;
  summaryFormat: 'plain' | 'html';
  acceptance: string | null;
  notes: string | null;
  blockedReason: string | null;
}
export interface Member {
  id: string;
  displayName: string;
  active: boolean;
}
export interface Field {
  key: keyof Item;
  label: string;
  type?: 'date' | 'long' | 'member' | 'rich';
  options?: Record<string, string>;
}
export const kinds = {
  function: '功能',
  interface: '接口',
  report: '报表',
  enhancement: '增强',
  form: '表单',
};
export const fields: Field[] = [
  { key: 'name', label: '开发名称' },
  { key: 'module', label: '模块' },
  { key: 'kind', label: '类型', options: kinds },
  {
    key: 'changeType',
    label: '变更类型',
    options: { new: '新增', optimize: '优化', rebuild: '重构' },
  },
  { key: 'priority', label: '优先级', options: { high: '高', medium: '中', low: '低' } },
  { key: 'businessOwnerId', label: '业务顾问', type: 'member' },
  { key: 'developerId', label: '开发人员', type: 'member' },
  { key: 'testerId', label: '测试负责人', type: 'member' },
  { key: 'plannedFsDate', label: 'FS 计划完成', type: 'date' },
  { key: 'plannedDevDate', label: '开发计划完成', type: 'date' },
  { key: 'plannedTestDate', label: '测试计划完成', type: 'date' },
  { key: 'summary', label: '需求描述', type: 'rich' },
  { key: 'acceptance', label: '验收条件', type: 'long' },
  { key: 'blockedReason', label: '阻塞原因', type: 'long' },
  { key: 'notes', label: '备注', type: 'long' },
];
export const chapters = [
  { key: 'background', label: '业务背景', hint: '描述当前业务、痛点与预期收益。' },
  { key: 'scope', label: '范围与边界', hint: '明确本次包含与不包含的功能、组织范围和前提。' },
  { key: 'inputs', label: '输入与选择条件', hint: '记录字段、类型、必填性、默认值与校验规则。' },
  { key: 'rules', label: '业务规则', hint: '按场景描述处理逻辑、取数关系、计算规则和 SAP 对象。' },
  { key: 'outputs', label: '输出与界面', hint: '列明输出字段、布局、排序和消息。' },
  { key: 'authorization', label: '权限与控制', hint: '描述组织权限、授权对象与敏感操作。' },
  { key: 'exceptions', label: '异常处理', hint: '列出错误场景、提示、回滚或重试规则。' },
  { key: 'acceptance', label: '验收条件', hint: '用可验证的条件说明业务通过标准。' },
  { key: 'cases', label: '初版测试案例', hint: '手工填写前置条件、测试数据、步骤与预期结果。' },
];
export interface Version {
  id: string;
  number: number;
  fsNumber: string;
  sections: Record<string, string>;
  note: string;
  authorName: string;
  createdAt: string;
}
export interface Fs {
  fsNumber: string;
  sections: Record<string, string>;
  rowVersion: string;
  submittedVersionId: string | null;
  versions: Version[];
}
export function display(item: Item, field: Field, members: Member[]) {
  const value = item[field.key];
  if (!value) return '—';
  if (field.key === 'summary') return requirementText(value, item.summaryFormat);
  return field.type === 'member'
    ? (members.find((m) => m.id === value)?.displayName ?? '历史成员')
    : (field.options?.[value] ?? value);
}
