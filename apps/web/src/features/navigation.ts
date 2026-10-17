export interface MenuItem {
  id: string;
  label: string;
  icon: string;
  description: string;
  path: string;
}
const item = (id: string, label: string, icon: string, description: string): MenuItem => ({
  id,
  label,
  icon,
  description,
  path: '/workspace/' + id,
});
export const groups = [
  {
    id: 'delivery',
    label: '开发管理',
    icon: 'layers',
    items: [
      item('development-overview', '开发概览', 'grid', '按项目角色展示开发驾驶舱，后续规划实现。'),
      item('development-items', '开发清单', 'file', '维护开发台账、需求概览和 FS 功能规格。'),
    ],
  },
  {
    id: 'knowledge',
    label: '知识与资产',
    icon: 'library',
    items: [
      item('qa', '知识问答', 'message', '在授权的组织或项目知识范围内提问，查看答案依据与来源。'),
      item(
        'knowledge',
        '知识库',
        'book',
        '沉淀 SAP 业务知识、技术规范与项目经验，管理来源和版本。',
      ),
      item('assets', '代码资产', 'code', '查找经过验证的成熟代码与工具，按指定版本在项目中复用。'),
      item(
        'templates',
        '文档模板',
        'files',
        '统一 FS、TS、测试与评审模板，保留项目采用的模板版本。',
      ),
    ],
  },
  {
    id: 'admin',
    label: '后台管理',
    icon: 'settings',
    items: [
      item('admin', '总览', 'settings', '后台管理的全部设置。'),
      item('organization-profile', '企业资料', 'building', '维护当前企业资料。'),
      item(
        'organization',
        '客户与项目',
        'building',
        '管理企业资料、客户档案与关联项目，梳理交付业务关系。',
      ),
      item('members', '用户与成员', 'users', '管理账号以及企业、项目成员关系，保留历史身份引用。'),
      item(
        'permissions',
        '角色与权限',
        'shield',
        '配置访问与操作授权；完整权限体系将在后续专题中实现。',
      ),
      item('connections', 'SAP系统', 'plug', '管理 SAP 后端系统、归属客户与临时使用授权。'),
      item('models', '大模型(LLM)', 'sparkles', '维护模型接入、测试与组织默认模型。'),
      item(
        'technical-verification',
        '技术验证（临时）',
        'plug',
        '通过 ABAP ADT MCP 验证 SAP 表结构读取。',
      ),
      item('workflows', '提示词与流程', 'workflow', '维护受限提示词、模板版本与交付流程规则。'),
      item('tasks', '运行任务', 'activity', '跟踪 AI 与工具任务的执行状态、错误与重试。'),
      item(
        'audit',
        '审计日志',
        'history',
        '复核 FSD 设计助手运行并记录评论，查看操作审计与优化建议。',
      ),
    ],
  },
];
export const home: MenuItem = {
  id: 'home',
  label: '工作台',
  icon: 'grid',
  description: '从这里开始，推进每一次交付。',
  path: '/home',
};
export const menus = [home, ...groups.flatMap((group) => group.items)];

// The shell (DESIGN.md 4.1): the icon rail lists modules; the secondary menu shows the current
// module's items, in sections where a module has many (DESIGN.md 4.2).
export interface Module {
  id: string;
  label: string;
  icon: string;
  path: string;
  sections: { label?: string; items: MenuItem[] }[];
}
const pick = (ids: string[]) =>
  ids.map((id) => menus.find((m) => m.id === id)).filter((m): m is MenuItem => !!m);
export const modules: Module[] = [
  { id: 'home', label: '工作台', icon: 'grid', path: home.path, sections: [{ items: [home] }] },
  ...groups.map((group) => ({
    id: group.id,
    label: group.label,
    icon: group.icon,
    // The rail opens the page people use most: the development list for 开发管理.
    path: (group.items.find((i) => i.id === 'development-items') ?? group.items[0]).path,
    sections:
      group.id === 'admin'
        ? [
            { items: pick(['admin']) },
            {
              label: '组织',
              items: pick(['organization-profile', 'organization', 'members', 'permissions']),
            },
            {
              label: '系统与模型',
              items: pick(['connections', 'models', 'technical-verification']),
            },
            { label: '运行与审计', items: pick(['workflows', 'tasks', 'audit']) },
          ]
        : [{ items: group.items }],
  })),
];
// The module a route belongs to: development items and their assistants belong to delivery.
export function moduleOf(path: string): Module {
  if (path.includes('/development-items/')) return modules.find((m) => m.id === 'delivery')!;
  return (
    modules.find((m) => m.sections.some((s) => s.items.some((i) => i.path === path))) ?? modules[0]
  );
}
