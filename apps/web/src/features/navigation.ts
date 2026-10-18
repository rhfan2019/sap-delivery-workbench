// The navigation of the shell (DESIGN.md 4.1) and the settings menu
// (docs/specs/project-access-admin.md 4.3). Every page is listed, built or not: a planned page
// opens the shared “规划中” page. Visibility follows the permission catalog; the API checks
// every request again.
import type { ProjectAccess } from '../services/session';

export type MenuScope = 'personal' | 'project' | 'organization';
export interface MenuItem {
  id: string;
  label: string;
  icon: string;
  description: string;
  path: string;
  // The view permission of the page: organization or project level per `scope`.
  permission?: string;
  scope?: MenuScope;
  planned?: boolean;
}
const item = (
  id: string,
  label: string,
  icon: string,
  description: string,
  extra: Partial<MenuItem> = {},
): MenuItem => ({ id, label, icon, description, path: '/workspace/' + id, ...extra });
const setting = (
  id: string,
  path: string,
  label: string,
  icon: string,
  description: string,
  extra: Partial<MenuItem> = {},
): MenuItem => ({ id, label, icon, description, path: '/settings' + path, ...extra });

export interface MenuSection {
  id: string;
  label?: string;
  note?: string;
  items: MenuItem[];
}
export interface Module {
  id: string;
  label: string;
  icon: string;
  path: string;
  sections: MenuSection[];
}

export const home: MenuItem = {
  id: 'home',
  label: '工作台',
  icon: 'grid',
  description: '从这里开始，推进每一次交付。',
  path: '/home',
};
const delivery: MenuItem[] = [
  item('development-overview', '开发概览', 'grid', '按项目角色展示开发驾驶舱。', { planned: true }),
  item('development-items', '开发清单', 'file', '维护开发台账，从开发项进入设计与开发助手。'),
];
const knowledge: MenuItem[] = [
  item('qa', '知识问答', 'message', '在授权的知识范围内提问，查看答案依据与来源。', {
    planned: true,
  }),
  item('knowledge', '知识库', 'book', '沉淀 SAP 业务知识、技术规范与项目经验。', { planned: true }),
  item('assets', '代码资产', 'code', '查找经过验证的成熟代码与工具，在项目中复用。', {
    planned: true,
  }),
  item('templates', '文档模板', 'files', '统一 FS、TS、测试与评审模板。', { planned: true }),
];

export const settingsOverview = setting(
  'settings',
  '',
  '概览',
  'settings',
  '个人、项目与企业的全部设置。',
);
export const settingsSections: MenuSection[] = [
  {
    id: 'personal',
    label: '个人',
    note: '你的资料与密码，以及在各项目 SAP 系统中使用的本人凭据。',
    items: [
      setting(
        'profile',
        '/profile',
        '个人资料',
        'user',
        '姓名、邮箱、职位与擅长模块；修改登录密码。',
      ),
      setting(
        'sap-credentials',
        '/sap-credentials',
        '我的 SAP 凭据',
        'key',
        '各项目、各系统的本人 SAP 用户；登录、删除与到期时间。',
      ),
      setting(
        'notifications',
        '/notifications',
        '通知',
        'bell',
        '选择接收哪些提醒，例如里程碑到期、权限即将到期。',
        { planned: true },
      ),
    ],
  },
  {
    id: 'project',
    label: '项目',
    note: '当前项目的信息、计划、团队、成员权限与 SAP 系统。',
    items: [
      setting(
        'project-general',
        '/project/general',
        '基本信息',
        'folder',
        '项目信息、实施方法与 SAP 系统形态。',
        { scope: 'project', permission: 'project:view' },
      ),
      setting(
        'project-plan',
        '/project/plan',
        '计划与健康',
        'calendar',
        '阶段、里程碑与每周健康度。',
        { scope: 'project', permission: 'project:view' },
      ),
      setting(
        'project-team',
        '/project/team',
        '团队与干系人',
        'contact',
        '关键岗位、模块负责人与客户方联系人。',
        { scope: 'project', permission: 'project:view' },
      ),
      setting(
        'project-members',
        '/project/members',
        '成员与权限',
        'users',
        '项目成员、项目内角色、模块范围与有效期。',
        { scope: 'project', permission: 'project.member:view' },
      ),
      setting(
        'project-sap',
        '/project/sap',
        'SAP 系统',
        'server',
        '项目的开发与测试系统、默认系统与连接测试。',
        { scope: 'project', permission: 'project.sap:view' },
      ),
      setting(
        'project-commercial',
        '/project/commercial',
        '规模与商务',
        'coins',
        '合同、人天预算与已计划人天。',
        { scope: 'project', permission: 'project.commercial:view' },
      ),
      setting(
        'project-delivery',
        '/project/delivery',
        '开发清单设置',
        'list',
        '模块选项、自定义列与标签（目前在开发清单页的列设置中维护）。',
        { scope: 'project', permission: 'delivery.config:manage', planned: true },
      ),
      setting(
        'project-models',
        '/project/models',
        '模型与智能体',
        'sparkles',
        '本项目允许使用的大模型。',
        { scope: 'project', permission: 'project:edit', planned: true },
      ),
    ],
  },
  {
    id: 'organization',
    label: '企业',
    note: '企业资料、客户与项目、账号、职位、角色权限与安全策略。',
    items: [
      setting('organization', '/organization', '企业资料', 'building', '企业名称与编码。', {
        scope: 'organization',
        permission: 'org.profile:view',
      }),
      setting('customers', '/customers', '客户', 'briefcase', '客户档案与其项目。', {
        scope: 'organization',
        permission: 'customer:view',
      }),
      setting('projects', '/projects', '项目', 'folders', '企业的全部项目：新建、查看与归档。', {
        scope: 'organization',
        permission: 'project.directory:view',
      }),
      setting(
        'project-fields',
        '/project-fields',
        '项目字段',
        'sliders',
        '为项目增加企业关心的扩展字段。',
        { scope: 'organization', permission: 'customer:manage', planned: true },
      ),
      setting('users', '/users', '用户', 'users', '账号、人员类型、职位、企业级角色与有效权限。', {
        scope: 'organization',
        permission: 'user:view',
      }),
      setting('positions', '/positions', '职位', 'id', '职位与其默认角色。', {
        scope: 'organization',
        permission: 'user:view',
      }),
      setting('roles', '/roles', '角色与权限', 'shield', '单一角色、复合角色、权限点与权限报表。', {
        scope: 'organization',
        permission: 'role:view',
      }),
      setting('security', '/security', '安全策略', 'lock', 'SAP 密码保存策略与强制清除凭据。', {
        scope: 'organization',
        permission: 'org.security:manage',
      }),
    ],
  },
  {
    id: 'agents',
    label: '智能体',
    note: '助手使用的大模型与提示词。',
    items: [
      setting('models', '/models', '大模型', 'sparkles', '模型接入、测试与企业默认模型。', {
        scope: 'organization',
        permission: 'model:view',
      }),
      setting(
        'prompts',
        '/prompts',
        '提示词与框架',
        'workflow',
        '助手的系统指令与开发框架默认类名。',
        { scope: 'organization', permission: 'model:manage', planned: true },
      ),
    ],
  },
  {
    id: 'operations',
    label: '审计与运维',
    note: '操作审计、助手运行复核与 SAP 连接。',
    items: [
      setting('audit', '/audit', '审计日志', 'history', '助手运行日志、操作审计与优化建议。', {
        scope: 'organization',
        permission: 'audit:view',
      }),
      setting(
        'sap-directory',
        '/sap-directory',
        'SAP 系统一览',
        'database',
        '全企业各项目登记的 SAP 系统（只读）。',
        { scope: 'organization', permission: 'sap.directory:view' },
      ),
      setting(
        'diagnostics',
        '/diagnostics',
        '连接诊断',
        'plug',
        '用部署配置的凭据验证 SAP 表结构读取。',
        { scope: 'organization', permission: 'ops.diagnostics:run' },
      ),
      setting('runs', '/runs', '运行记录', 'activity', '跟踪助手与工具任务的执行状态与重试。', {
        scope: 'organization',
        permission: 'audit:view',
        planned: true,
      }),
    ],
  },
];

export const modules: Module[] = [
  {
    id: 'home',
    label: '工作台',
    icon: 'grid',
    path: home.path,
    sections: [{ id: 'home', items: [home] }],
  },
  {
    id: 'delivery',
    label: '开发管理',
    icon: 'layers',
    path: '/workspace/development-items',
    sections: [{ id: 'delivery', items: delivery }],
  },
  {
    id: 'knowledge',
    label: '知识与资产',
    icon: 'library',
    path: '/workspace/qa',
    sections: [{ id: 'knowledge', items: knowledge }],
  },
  {
    id: 'settings',
    label: '设置',
    icon: 'settings',
    path: '/settings',
    sections: [{ id: 'overview', items: [settingsOverview] }, ...settingsSections],
  },
];
export const menus: MenuItem[] = modules.flatMap((m) => m.sections.flatMap((s) => s.items));

// The module a route belongs to: development items and their assistants belong to delivery,
// settings detail pages (a user, a role, an audit run) to settings.
export function moduleOf(path: string): Module {
  if (path.includes('/development-items/')) return modules.find((m) => m.id === 'delivery')!;
  if (path === '/settings' || path.startsWith('/settings/'))
    return modules.find((m) => m.id === 'settings')!;
  return (
    modules.find((m) => m.sections.some((s) => s.items.some((i) => i.path === path))) ?? modules[0]!
  );
}
// The menu entry a path belongs to (a detail page highlights its list).
export function entryOf(path: string): MenuItem | undefined {
  return (
    menus.find((m) => m.path === path) ??
    menus
      .filter((m) => m.path !== '/settings' && path.startsWith(m.path + '/'))
      .sort((a, b) => b.path.length - a.path.length)[0]
  );
}

export interface Visibility {
  organization: string[];
  project: ProjectAccess | null;
}
// May the user see this entry? Personal pages always; others by their view permission.
export function visible(entry: MenuItem, v: Visibility): boolean {
  if (!entry.permission) return true;
  if (entry.scope === 'project') return !!v.project?.permissions.includes(entry.permission);
  return v.organization.includes(entry.permission);
}
// The sections and entries the user may see; a section without any is left out.
export function visibleSections(sections: MenuSection[], v: Visibility): MenuSection[] {
  return sections
    .map((s) => ({ ...s, items: s.items.filter((i) => visible(i, v)) }))
    .filter((s) => s.items.length);
}
