// Permission catalog, built-in roles and positions shared by the API (checks, role editor,
// startup sync) and the web (menus, buttons, role editor). Pure data: no decisions here.
// Design: docs/specs/project-access-admin.md section 2.

// A group is one menu area in the role editor tree. `scope` decides where a permission applies:
// 'organization' (organization-wide) or 'project' (inside one project).
export const PERMISSION_GROUPS = [
  { key: 'project', label: '项目', scope: 'project' },
  { key: 'project.member', label: '项目成员', scope: 'project' },
  { key: 'project.sap', label: '项目 SAP 系统', scope: 'project' },
  { key: 'delivery', label: '开发清单', scope: 'project' },
  { key: 'delivery.overview', label: '开发概览', scope: 'project' },
  { key: 'agent.fsd', label: 'FSD 设计助手', scope: 'project' },
  { key: 'agent.dev', label: 'ABAP 开发助手', scope: 'project' },
  { key: 'sap', label: 'SAP 访问', scope: 'project' },
  { key: 'org', label: '企业', scope: 'organization' },
  { key: 'customer', label: '客户与项目', scope: 'organization' },
  { key: 'delivery.portfolio', label: '项目组合', scope: 'organization' },
  { key: 'user', label: '用户与职位', scope: 'organization' },
  { key: 'role', label: '角色与权限', scope: 'organization' },
  { key: 'model', label: '智能体', scope: 'organization' },
  { key: 'sap.directory', label: 'SAP 系统一览', scope: 'organization' },
  { key: 'audit', label: '审计与运维', scope: 'organization' },
];

// kind: 'menu' (the page's view permission), 'action' or 'field'. The first permission of a
// group is its view permission; picking any other permission of the group implies it.
const p = (code, group, kind, label, description) => ({ code, group, kind, label, description });
export const PERMISSIONS = [
  p('project:view', 'project', 'menu', '查看项目', '进入项目，查看基本信息、计划与团队。'),
  p('project:edit', 'project', 'action', '修改基本信息', '修改项目基本信息与 SAP 系统形态。'),
  p('project.plan:edit', 'project', 'action', '维护阶段与里程碑', '修改阶段日期、里程碑。'),
  p('project.health:edit', 'project', 'action', '更新健康度', '登记每周的项目健康度。'),
  p(
    'project.team:edit',
    'project',
    'action',
    '维护团队与干系人',
    '关键岗位、模块负责人与客户联系人。',
  ),
  p('project.contact:view', 'project', 'field', '查看客户联系人', '客户方联系人的电话与邮箱。'),
  p('project.commercial:view', 'project', 'field', '查看商务信息', '合同编号、模式、人天与预算。'),
  p('project.commercial:edit', 'project', 'field', '修改商务信息', '修改合同与人天预算。'),
  p('project:archive', 'project', 'action', '归档项目', '归档后项目只读。'),

  p('project.member:view', 'project.member', 'menu', '查看成员', '查看项目成员与其项目内角色。'),
  p('project.member:manage', 'project.member', 'action', '管理成员', '增删成员、分配项目内角色。'),

  p('project.sap:view', 'project.sap', 'menu', '查看 SAP 系统', '查看项目登记的开发与测试系统。'),
  p(
    'project.sap:manage',
    'project.sap',
    'action',
    '管理 SAP 系统',
    '登记、修改、停用系统与设默认。',
  ),

  p('delivery.item:view', 'delivery', 'menu', '查看开发清单', '查看开发项、附件与变更历史。'),
  p('delivery.item:create', 'delivery', 'action', '新建开发项', '新建与复制开发项。'),
  p('delivery.item:edit', 'delivery', 'action', '修改开发项', '修改开发项、阶段，上传与删除附件。'),
  p('delivery.item:delete', 'delivery', 'action', '删除开发项', '删除开发项（含批量删除）。'),
  p('delivery.item:import', 'delivery', 'action', '导入开发项', '从 Excel 导入开发项。'),
  p('delivery.item:export', 'delivery', 'action', '导出开发项', '把开发清单导出为 Excel。'),
  p('delivery.config:manage', 'delivery', 'action', '维护清单设置', '自定义列与标签。'),

  p(
    'delivery.overview:view',
    'delivery.overview',
    'menu',
    '查看开发概览',
    '查看开发驾驶舱的统计与风险清单。',
  ),
  p(
    'delivery.overview.team:view',
    'delivery.overview',
    'field',
    '查看团队负载',
    '在开发概览中查看他人的负载与姓名。',
  ),

  p('agent.fsd:view', 'agent.fsd', 'menu', '查看设计', '在开发项中查看功能说明书（成果）。'),
  p('agent.fsd:run', 'agent.fsd', 'action', '使用设计助手', '进入设计助手：对话、上传资料、批注。'),
  p('agent.fsd:finalize', 'agent.fsd', 'action', '定稿功能说明书', '给功能说明书版本打定稿标签。'),

  p('agent.dev:view', 'agent.dev', 'menu', '查看开发', '在开发项中查看开发方案与代码（成果）。'),
  p(
    'agent.dev:run',
    'agent.dev',
    'action',
    '使用开发助手',
    '进入开发助手：对话、批注、上传或从 SAP 同步代码。',
  ),
  p('agent.dev:finalize', 'agent.dev', 'action', '定稿代码', '给代码版本打定稿标签。'),

  p('sap.development:read', 'sap', 'action', '读取开发系统', '助手用本人的 SAP 用户读取开发系统。'),
  p('sap.test:read', 'sap', 'action', '读取测试系统', '助手用本人的 SAP 用户读取测试系统。'),
  p('sap.test_data:create', 'sap', 'action', '创建测试数据', '经逐次授权在测试系统创建测试单据。'),

  p('org.profile:view', 'org', 'menu', '查看企业资料', '查看企业名称与编码。'),
  p('org.profile:edit', 'org', 'action', '修改企业资料', '修改企业名称与编码。'),
  p('org.security:manage', 'org', 'action', '管理安全策略', 'SAP 凭据保存策略与强制清除凭据。'),

  p('customer:view', 'customer', 'menu', '查看客户', '查看客户档案。'),
  p('customer:manage', 'customer', 'action', '管理客户', '新建、修改、停用与删除客户。'),
  p('project.directory:view', 'customer', 'action', '查看全部项目', '查看企业的全部项目一览。'),
  p('project:create', 'customer', 'action', '新建项目', '新建项目（建立后可在项目设置中维护）。'),

  p('user:view', 'user', 'menu', '查看用户', '查看账号、职位与权限。'),
  p('user:manage', 'user', 'action', '管理用户', '新建、修改、停用账号。'),
  p('user.password:reset', 'user', 'action', '重置密码', '为他人生成临时密码。'),
  p('position:manage', 'user', 'action', '管理职位', '维护职位与其默认角色。'),

  p('role:view', 'role', 'menu', '查看角色与权限', '查看角色、权限点与权限报表。'),
  p('role:manage', 'role', 'action', '管理角色', '新建、修改、停用自定义角色。'),
  p('assignment:manage', 'role', 'action', '分配企业级角色', '为用户分配或撤销企业级角色。'),

  p(
    'delivery.portfolio:view',
    'delivery.portfolio',
    'menu',
    '查看项目组合',
    '在开发概览中跨项目查看风险、冻结与预算。',
  ),

  p('model:view', 'model', 'menu', '查看大模型', '查看模型接入与测试结果。'),
  p('model:manage', 'model', 'action', '管理大模型', '接入、修改、测试模型，设企业默认模型。'),

  p(
    'sap.directory:view',
    'sap.directory',
    'menu',
    '查看 SAP 系统一览',
    '只读查看各项目登记的系统。',
  ),

  p('audit:view', 'audit', 'menu', '查看审计日志', '助手运行日志、操作审计与优化建议。'),
  p('audit:comment', 'audit', 'action', '评论助手运行', '对助手运行发表与删除评论。'),
  p('ops.diagnostics:run', 'audit', 'action', '连接诊断', '用临时凭据验证 SAP 表结构读取。'),
];

export const PERMISSION_CODES = PERMISSIONS.map((x) => x.code);
export const permissionOf = (code) => PERMISSIONS.find((x) => x.code === code);
export const groupOf = (key) => PERMISSION_GROUPS.find((g) => g.key === key);
export const scopeOf = (code) => groupOf(permissionOf(code)?.group)?.scope;
export const PROJECT_PERMISSIONS = PERMISSION_CODES.filter((c) => scopeOf(c) === 'project');
export const ORGANIZATION_PERMISSIONS = PERMISSION_CODES.filter(
  (c) => scopeOf(c) === 'organization',
);
// The view permission a group's other permissions imply.
export const viewOf = (code) => {
  const group = permissionOf(code)?.group;
  return PERMISSIONS.find((x) => x.group === group)?.code;
};
// Inside a project, a member may hand out any project role, except one carrying these unless
// the member holds them in that project (section 2.7).
export const SENSITIVE_PERMISSIONS = [
  'project.member:manage',
  'project.commercial:view',
  'project.commercial:edit',
  'project:archive',
];
// Permissions narrowed by an assignment's module scope and "own items only" (section 2.4).
export const SCOPED_PERMISSIONS = [
  'delivery.overview:view',
  'delivery.item:create',
  'delivery.item:edit',
  'delivery.item:delete',
  'agent.fsd:run',
  'agent.fsd:finalize',
  'agent.dev:run',
  'agent.dev:finalize',
];

const single = (code, scope, name, description, permissions) => ({
  code,
  kind: 'single',
  scope,
  name,
  description,
  permissions,
});
const composite = (code, scope, name, description, members) => ({
  code,
  kind: 'composite',
  scope,
  name,
  description,
  members,
});
const project = (prefix) => PROJECT_PERMISSIONS.filter((c) => c.startsWith(prefix));
export const SUPER_ADMIN = 'SYS_SUPER_ADMIN';

// Built-in roles: synchronized at startup, read-only in the role editor, may be copied.
export const BUILT_IN_ROLES = [
  single(SUPER_ADMIN, 'organization', '超级管理员', '全部权限，含全部项目。', PERMISSION_CODES),
  single('SYS_USER_ADMIN', 'organization', '用户管理员', '管理账号、职位与密码。', [
    'org.profile:view',
    'user:view',
    'user:manage',
    'user.password:reset',
    'position:manage',
    'role:view',
  ]),
  single('SYS_ROLE_ADMIN', 'organization', '权限管理员', '维护角色并分配企业级角色。', [
    'user:view',
    'role:view',
    'role:manage',
    'assignment:manage',
  ]),
  single(
    'SYS_PROJECT_ADMIN',
    'organization',
    '项目管理员',
    '管理客户、建项目、配置项目成员与系统。',
    [
      'customer:view',
      'customer:manage',
      'project.directory:view',
      'project:create',
      'user:view',
      'project:view',
      'project:edit',
      'project.plan:edit',
      'project.team:edit',
      'project.contact:view',
      'project.commercial:view',
      'project.commercial:edit',
      'project:archive',
      'project.member:view',
      'project.member:manage',
      'project.sap:view',
      'project.sap:manage',
    ],
  ),
  single('SYS_PLATFORM', 'organization', '平台配置员', '企业资料、安全策略、大模型与连接诊断。', [
    'org.profile:view',
    'org.profile:edit',
    'org.security:manage',
    'model:view',
    'model:manage',
    'sap.directory:view',
    'ops.diagnostics:run',
  ]),
  single(
    'SYS_AUDITOR',
    'organization',
    '审计员',
    '只读查看审计日志、用户与角色，可评论助手运行。',
    ['audit:view', 'audit:comment', 'user:view', 'role:view'],
  ),
  single('PRJ_VIEW', 'project', '项目查看', '进入项目，查看开发清单与设计、开发成果。', [
    'project:view',
    'project.member:view',
    'project.sap:view',
    'delivery.item:view',
    'delivery.overview:view',
    'agent.fsd:view',
    'agent.dev:view',
  ]),
  single('PRJ_MANAGE', 'project', '项目管理', '维护项目信息、计划、健康度、团队与成员。', [
    'project:edit',
    'project.plan:edit',
    'project.health:edit',
    'project.team:edit',
    'project.member:manage',
    'project:archive',
  ]),
  single('PRJ_CONTACT', 'project', '客户联系人', '查看客户方联系人的联系方式。', [
    'project.contact:view',
  ]),
  single(
    'PRJ_COMMERCIAL',
    'project',
    '项目商务',
    '查看与修改合同、人天与预算。',
    project('project.commercial'),
  ),
  single('PRJ_SAP', 'project', '项目系统管理', '登记与维护项目的 SAP 系统。', [
    'project.sap:manage',
  ]),
  single('DL_EDIT', 'project', '开发清单维护', '新建、修改与导出开发项。', [
    'delivery.item:create',
    'delivery.item:edit',
    'delivery.item:export',
  ]),
  single('DL_TEAM', 'project', '开发团队视图', '在开发概览中查看他人的负载与姓名。', [
    'delivery.overview.team:view',
  ]),
  single('DL_ADMIN', 'project', '开发清单管理', '删除、导入开发项，维护自定义列与标签。', [
    'delivery.item:delete',
    'delivery.item:import',
    'delivery.config:manage',
  ]),
  single('PF_VIEW', 'organization', '项目组合查看', '跨项目查看开发风险、冻结与预算。', [
    'delivery.portfolio:view',
  ]),
  single('AG_FSD', 'project', 'FSD 设计', '使用设计助手写功能说明书并定稿。', [
    'agent.fsd:run',
    'agent.fsd:finalize',
    'sap.development:read',
    'sap.test:read',
  ]),
  single('AG_DEV', 'project', 'ABAP 开发', '使用开发助手写开发方案与代码并定稿。', [
    'agent.dev:run',
    'agent.dev:finalize',
    'sap.development:read',
    'sap.test:read',
  ]),
  single('AG_TEST', 'project', '测试', '读取测试系统并经授权创建测试数据。', [
    'sap.test:read',
    'sap.test_data:create',
  ]),
  composite('C_PM', 'project', '项目经理', '管理项目、成员、系统与开发清单。', [
    'PRJ_VIEW',
    'PRJ_MANAGE',
    'PRJ_CONTACT',
    'PRJ_COMMERCIAL',
    'PRJ_SAP',
    'DL_EDIT',
    'DL_ADMIN',
    'DL_TEAM',
  ]),
  composite('C_ARCHITECT', 'project', '方案架构师', '维护开发清单，使用设计与开发助手。', [
    'PRJ_VIEW',
    'PRJ_CONTACT',
    'DL_EDIT',
    'DL_ADMIN',
    'AG_FSD',
    'AG_DEV',
  ]),
  composite('C_FUNC', 'project', '业务顾问', '维护开发清单，写功能说明书，做顾问测试。', [
    'PRJ_VIEW',
    'PRJ_CONTACT',
    'DL_EDIT',
    'AG_FSD',
    'AG_TEST',
  ]),
  composite('C_DEV_LEAD', 'project', '开发组长', '管理开发清单与项目系统，使用开发助手。', [
    'PRJ_VIEW',
    'DL_EDIT',
    'DL_ADMIN',
    'DL_TEAM',
    'AG_DEV',
    'PRJ_SAP',
  ]),
  composite('C_DEV', 'project', '开发顾问', '维护开发清单，使用开发助手。', [
    'PRJ_VIEW',
    'DL_EDIT',
    'AG_DEV',
  ]),
  composite('C_BASIS', 'project', 'Basis 顾问', '维护项目的 SAP 系统。', ['PRJ_VIEW', 'PRJ_SAP']),
  composite('C_TESTER', 'project', '测试人员', '读取测试系统并创建测试数据。', [
    'PRJ_VIEW',
    'AG_TEST',
  ]),
  composite('C_SUBCON_DEV', 'project', '分包开发', '只使用开发助手，通常限本人负责。', [
    'PRJ_VIEW',
    'AG_DEV',
  ]),
  composite('C_OBSERVER', 'project', '观察者', '只读查看项目。', ['PRJ_VIEW']),
  composite('C_DELIVERY_DIRECTOR', 'organization', '交付总监', '跨项目查看进度、联系人与商务。', [
    'PRJ_VIEW',
    'PRJ_CONTACT',
    'PRJ_COMMERCIAL',
    'PF_VIEW',
  ]),
  composite('C_PMO', 'organization', 'PMO', '跨项目查看项目与联系人。', [
    'PRJ_VIEW',
    'PRJ_CONTACT',
    'PF_VIEW',
  ]),
];
export const builtInRole = (code) => BUILT_IN_ROLES.find((r) => r.code === code);

// Built-in positions: created once per organization, then ordinary editable data.
export const BUILT_IN_POSITIONS = [
  {
    code: 'DELIVERY_DIRECTOR',
    name: '交付总监',
    organizationRoles: ['C_DELIVERY_DIRECTOR'],
    projectRoles: ['C_PM'],
  },
  { code: 'PROJECT_MANAGER', name: '项目经理', organizationRoles: [], projectRoles: ['C_PM'] },
  { code: 'ARCHITECT', name: '方案架构师', organizationRoles: [], projectRoles: ['C_ARCHITECT'] },
  { code: 'FUNCTIONAL', name: '业务顾问', organizationRoles: [], projectRoles: ['C_FUNC'] },
  { code: 'DEV_LEAD', name: '开发组长', organizationRoles: [], projectRoles: ['C_DEV_LEAD'] },
  { code: 'DEVELOPER', name: '开发顾问', organizationRoles: [], projectRoles: ['C_DEV'] },
  { code: 'BASIS', name: 'Basis 顾问', organizationRoles: [], projectRoles: ['C_BASIS'] },
  { code: 'TESTER', name: '测试工程师', organizationRoles: [], projectRoles: ['C_TESTER'] },
  { code: 'PMO', name: 'PMO', organizationRoles: ['C_PMO'], projectRoles: ['C_OBSERVER'] },
  { code: 'SYSTEM_ADMIN', name: '系统管理员', organizationRoles: [SUPER_ADMIN], projectRoles: [] },
];

export const PERSON_TYPES = { employee: '员工', subcontractor: '分包', external: '外部' };
export const PROJECT_SCOPES = {
  all: '全部项目',
  customers: '指定客户的项目',
  projects: '指定项目',
  none: '不含项目',
};
