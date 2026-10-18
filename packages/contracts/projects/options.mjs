// Project master data options shared by the API (validation, defaults) and the web (forms, labels).
// Design: docs/specs/project-access-admin.md section 1.

export const PROJECT_TYPES = {
  implementation: '新实施',
  rollout: '模板推广',
  upgrade: '系统升级',
  conversion: 'S/4HANA 转换',
  enhancement: '功能增强',
  support: '运维支持',
  migration: '数据迁移',
  other: '其他',
};
export const PROJECT_STATUSES = {
  preparing: '筹备',
  active: '实施中',
  live: '已上线',
  completed: '已结束',
  archived: '已归档',
};
export const METHODOLOGIES = {
  activate: 'SAP Activate',
  asap: 'ASAP',
  agile: '敏捷迭代',
  hybrid: '混合',
};
export const CONTRACT_ROLES = { prime: '总包', subcontract: '分包', direct: '与客户直签' };
export const SAP_PRODUCTS = {
  ecc: 'ECC 6.0',
  s4_onpremise: 'S/4HANA（本地）',
  s4_private: 'S/4HANA Cloud 私有云',
  s4_public: 'S/4HANA Cloud 公有云',
  bw4: 'BW/4HANA',
  other: '其他',
};
export const DEPLOYMENTS = {
  on_premise: '客户机房',
  private_cloud: '私有云',
  public_cloud: '公有云',
};
export const SAP_MODULES = [
  'FICO',
  'MM',
  'SD',
  'PP',
  'QM',
  'PM',
  'PS',
  'WM',
  'EWM',
  'TM',
  'HCM',
  'BW',
  'BTP',
];
export const TRANSPORT_METHODS = { charm: 'ChaRM', manual: '手工传输请求' };
export const CONTRACT_MODELS = {
  fixed: '固定总价',
  per_day: '人天计价',
  time_material: '按实际工时',
};

// Key positions recorded on the project (project member user ids).
export const KEY_ROLES = {
  manager: '项目经理',
  director: '项目总监',
  architect: '方案架构师',
  devLead: '开发组长',
  basisLead: 'Basis 负责人',
};

// SAP Activate phases created with every project; names can be changed.
export const PHASES = [
  { key: 'discover', name: '发现' },
  { key: 'prepare', name: '准备' },
  { key: 'explore', name: '探索' },
  { key: 'realize', name: '实现' },
  { key: 'deploy', name: '部署' },
  { key: 'run', name: '运行' },
];
export const PHASE_STATUSES = { not_started: '未开始', in_progress: '进行中', completed: '已完成' };

// Milestones created with every project. `key` lets other pages find them (code freeze, go-live).
export const MILESTONES = [
  { key: 'kickoff', name: '项目启动会', phase: 'prepare' },
  { key: 'blueprint_signoff', name: '蓝图签字', phase: 'explore' },
  { key: 'code_freeze', name: '开发冻结', phase: 'realize' },
  { key: 'sit_start', name: '集成测试（SIT）开始', phase: 'realize' },
  { key: 'sit_end', name: '集成测试（SIT）结束', phase: 'realize' },
  { key: 'uat_done', name: '用户验收（UAT）完成', phase: 'deploy' },
  { key: 'cutover_start', name: '切换开始', phase: 'deploy' },
  { key: 'go_live', name: '上线', phase: 'deploy' },
  { key: 'hypercare_end', name: '上线支持结束', phase: 'run' },
];
// Derived milestone state (section 1.3): achieved, delayed, due within 7 days, upcoming.
export function milestoneState(m, today = new Date().toISOString().slice(0, 10)) {
  if (m.achievedOn) return 'achieved';
  if (!m.plannedOn) return 'unplanned';
  if (m.plannedOn < today) return 'delayed';
  const days = (Date.parse(m.plannedOn) - Date.parse(today)) / 86400000;
  return days <= 7 ? 'due' : 'upcoming';
}
export const MILESTONE_STATES = {
  achieved: '已达成',
  delayed: '已延期',
  due: '即将到期',
  upcoming: '未到',
  unplanned: '未排期',
};

export const CONTACT_ROLES = {
  customer_pm: '甲方项目经理',
  it_lead: 'IT 负责人',
  business_owner: '业务负责人',
  key_user: '关键用户',
  other: '其他',
};

export const HEALTH = { green: '正常', yellow: '有风险', red: '严重' };
export const HEALTH_DIMENSIONS = { schedule: '进度', scope: '范围', cost: '成本', quality: '质量' };
// A weekly report older than this is shown as stale.
export const HEALTH_STALE_DAYS = 14;
