import { failure } from '../../platform/auth.mjs';
import {
  CONTACT_ROLES,
  CONTRACT_MODELS,
  CONTRACT_ROLES,
  DEPLOYMENTS,
  HEALTH,
  METHODOLOGIES,
  PHASE_STATUSES,
  PROJECT_TYPES,
  SAP_MODULES,
  SAP_PRODUCTS,
  TRANSPORT_METHODS,
} from '@sap-delivery-workbench/contracts/projects/options';

export function text(value, label, max, { optional = false } = {}) {
  if (optional && (value === null || value === undefined || value === '')) return '';
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max)
    throw failure(400, `${label}不能为空且最多 ${max} 个字符。`);
  return value.trim();
}
export function choice(value, options, label, fallback) {
  const result = value ?? fallback;
  if (!options.includes(result)) throw failure(400, `${label}无效。`);
  return result;
}
// An optional choice: empty means not recorded (null).
export function option(value, options, label) {
  if (value === null || value === undefined || value === '') return null;
  return choice(value, options, label);
}
export function uuid(value) {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  )
    throw failure(400, '记录标识无效。');
  return value;
}
export const optionalUuid = (value) =>
  value === null || value === undefined || value === '' ? null : uuid(value);
export function version(value) {
  if (!/^[1-9]\d{0,15}$/.test(String(value)))
    throw failure(400, '缺少有效的数据版本，请刷新后重试。');
  return String(value);
}
export function code(value) {
  const result = text(value, '编码', 32).toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]{0,31}$/.test(result))
    throw failure(400, '编码只能包含英文字母、数字、下划线或连字符。');
  return result;
}
export function email(value) {
  const result = text(value, '邮箱', 254, { optional: true });
  if (result && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result))
    throw failure(400, '请输入有效的邮箱地址。');
  return result || null;
}
export function date(value) {
  if (value === null || value === undefined || value === '') return null;
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  )
    throw failure(400, '请输入有效日期。');
  return value;
}
function range(start, end, label = '结束日期不能早于开始日期。') {
  if (start && end && start > end) throw failure(400, label);
}
// One decimal place, not negative; empty means not recorded.
export function days(value, label) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 999999 || Math.round(n * 10) !== n * 10)
    throw failure(400, `${label}须为不小于 0、最多一位小数的数字。`);
  return n;
}
export function count(value, label) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 9999) throw failure(400, `${label}须为 0–9999 的整数。`);
  return n;
}
export function modules(value, label = '模块') {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((m) => !SAP_MODULES.includes(m)))
    throw failure(400, `${label}无效。`);
  return SAP_MODULES.filter((m) => value.includes(m));
}

export function customerInput(body = {}) {
  return {
    name: text(body.name, '客户名称', 200),
    code: code(body.code),
    customerKind: choice(body.customerKind, ['external', 'self'], '客户类型', 'external'),
    status: choice(body.status, ['active', 'inactive'], '客户状态', 'active'),
    description: text(body.description, '说明', 4000, { optional: true }),
  };
}
// Creating a project (the organization project list).
export function newProjectInput(body = {}) {
  const start = date(body.plannedStartDate),
    end = date(body.plannedEndDate);
  range(start, end);
  return {
    customerId: uuid(body.customerId),
    code: code(body.code),
    name: text(body.name, '项目名称', 200),
    shortName: text(body.shortName, '简称', 20, { optional: true }),
    projectType: choice(body.projectType, Object.keys(PROJECT_TYPES), '项目类型', 'implementation'),
    plannedStartDate: start,
    plannedEndDate: end,
    managerId: optionalUuid(body.managerId),
  };
}
// Basic information and SAP landscape (section 1.1, 1.2).
export function projectInput(body = {}) {
  const start = date(body.plannedStartDate),
    end = date(body.plannedEndDate);
  range(start, end);
  const namespace = text(body.namespace ?? 'Z', '开发命名空间', 12).toUpperCase();
  if (!/^(Z|Y|\/[A-Z0-9_]{1,10}\/)$/.test(namespace))
    throw failure(400, '开发命名空间为 Z、Y 或 /XXX/ 形式。');
  const pkg = text(body.defaultPackage, '默认开发包', 30, { optional: true }).toUpperCase();
  if (pkg && !/^[A-Z0-9_/$]{1,30}$/.test(pkg)) throw failure(400, '默认开发包名称无效。');
  const language = text(body.language ?? 'ZH', '主语言', 2).toUpperCase();
  if (!/^[A-Z]{2}$/.test(language)) throw failure(400, '主语言使用两位字母，例如 ZH、EN。');
  const contractRole = choice(body.contractRole, Object.keys(CONTRACT_ROLES), '我方角色', 'prime');
  return {
    code: code(body.code),
    name: text(body.name, '项目名称', 200),
    shortName: text(body.shortName, '简称', 20, { optional: true }),
    projectType: choice(body.projectType, Object.keys(PROJECT_TYPES), '项目类型', 'implementation'),
    status: choice(
      body.status,
      ['preparing', 'active', 'live', 'completed'],
      '项目状态',
      'preparing',
    ),
    isPaused: body.isPaused === true,
    methodology: choice(body.methodology, Object.keys(METHODOLOGIES), '实施方法论', 'activate'),
    contractRole,
    primeContractor:
      contractRole === 'subcontract' ? text(body.primeContractor, '总包方', 200) : '',
    description: text(body.description, '说明', 4000, { optional: true }),
    plannedStartDate: start,
    plannedEndDate: end,
    sapProduct: option(body.sapProduct, Object.keys(SAP_PRODUCTS), 'SAP 产品'),
    sapRelease: text(body.sapRelease, '产品版本', 60, { optional: true }),
    deployment: option(body.deployment, Object.keys(DEPLOYMENTS), '部署形态'),
    modules: modules(body.modules, '实施模块'),
    language,
    namespace,
    defaultPackage: pkg,
    transportMethod: option(body.transportMethod, Object.keys(TRANSPORT_METHODS), '传输方式'),
  };
}
export function commercialInput(body = {}) {
  return {
    contractNo: text(body.contractNo, '合同编号', 60, { optional: true }),
    contractModel: option(body.contractModel, Object.keys(CONTRACT_MODELS), '合同模式'),
    contractDays: days(body.contractDays, '合同人天'),
    devBudgetDays: days(body.devBudgetDays, '开发人天预算'),
    teamSize: count(body.teamSize, '计划团队规模'),
  };
}
export function phaseInput(body = {}) {
  const plannedStart = date(body.plannedStart),
    plannedEnd = date(body.plannedEnd),
    actualStart = date(body.actualStart),
    actualEnd = date(body.actualEnd);
  range(plannedStart, plannedEnd, '计划结束不能早于计划开始。');
  range(actualStart, actualEnd, '实际结束不能早于实际开始。');
  return {
    name: text(body.name, '阶段名称', 30),
    plannedStart,
    plannedEnd,
    actualStart,
    actualEnd,
    status: choice(body.status, Object.keys(PHASE_STATUSES), '阶段状态', 'not_started'),
  };
}
export function milestoneInput(body = {}) {
  return {
    name: text(body.name, '里程碑名称', 60),
    phaseKey: option(
      body.phaseKey,
      ['discover', 'prepare', 'explore', 'realize', 'deploy', 'run'],
      '所在阶段',
    ),
    plannedOn: date(body.plannedOn),
    achievedOn: date(body.achievedOn),
    notes: text(body.notes, '说明', 500, { optional: true }),
  };
}
export function contactInput(body = {}) {
  return {
    name: text(body.name, '姓名', 60),
    title: text(body.title, '职务', 60, { optional: true }),
    department: text(body.department, '部门', 60, { optional: true }),
    contactRole: choice(body.contactRole, Object.keys(CONTACT_ROLES), '联系人角色', 'other'),
    modules: modules(body.modules, '负责模块'),
    phone: text(body.phone, '电话', 40, { optional: true }),
    email: email(body.email) ?? '',
    notes: text(body.notes, '备注', 500, { optional: true }),
  };
}
export function healthInput(body = {}) {
  const level = (value, label) => choice(value, Object.keys(HEALTH), label);
  return {
    overall: level(body.overall, '综合状态'),
    schedule: level(body.schedule, '进度'),
    scope: level(body.scope, '范围'),
    cost: level(body.cost, '成本'),
    quality: level(body.quality, '质量'),
    note: text(body.note, '说明', 500, { optional: true }),
    reportedOn: date(body.reportedOn) ?? new Date().toISOString().slice(0, 10),
  };
}
