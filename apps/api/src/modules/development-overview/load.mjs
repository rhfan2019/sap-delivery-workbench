import {
  baseOptions,
  defaultBase,
  loadRows,
} from '@sap-delivery-workbench/contracts/delivery/load';
import { projectMembers } from '../access/public.mjs';
import { dateText } from '../delivery/store.mjs';

// 开发管理 → 开发排期 (docs/specs/development-load.md): the development load per developer and
// week. The API groups the items; the page lays out the weeks around the chosen Monday, so
// changing the base date needs no new request.

// Members holding one of these roles get a row even without work, so free capacity shows.
const DEVELOPER_ROLES = ['C_DEV', 'C_DEV_LEAD', 'C_SUBCON_DEV'];

// People in the table: developers among the members and everyone a development phase is
// assigned to; ordered by sort code (empty last), then name.
export function loadPeople(rows, members, everyone) {
  const ids = new Set(rows.map((r) => r.id).filter(Boolean));
  for (const m of members)
    if (m.roles.some((r) => r.active && DEVELOPER_ROLES.includes(r.roleCode))) ids.add(m.id);
  const sortCode = new Map(members.map((m) => [m.id, m.sortCode ?? null]));
  const names = new Map(everyone.map((p) => [p.id, p]));
  return [...ids]
    .map((id) => ({
      id,
      name: names.get(id)?.displayName ?? '未知用户',
      active: !!names.get(id)?.active,
      sortCode: sortCode.get(id) ?? null,
    }))
    .sort(
      (a, b) =>
        (a.sortCode ?? Infinity) - (b.sortCode ?? Infinity) ||
        a.name.localeCompare(b.name, 'zh-CN'),
    );
}

export function registerLoadRoutes(app, c, pool, organizationId) {
  app.get('/api/projects/:projectId/development-load', async (req) => {
    const { project } = await c.read(req, 'delivery.load:view');
    const [items, members, everyone] = await Promise.all([
      c.overview.items(pool, project.id),
      projectMembers(pool, organizationId, project.id),
      c.overview.members(pool, project.id),
    ]);
    const today = dateText(new Date());
    const start = dateText(project.planned_start_date);
    const end = dateText(project.planned_end_date);
    const options = baseOptions(start, end, today);
    const { totals, rows } = loadRows(items);
    return {
      today,
      project: { start, end },
      options,
      base: defaultBase(options, today),
      totals,
      people: loadPeople(rows, members, everyone),
      rows,
    };
  });
}
