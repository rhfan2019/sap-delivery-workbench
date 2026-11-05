// Saved views of a list report (docs/modules/list-report.md 4). `LIST_REPORTS` names every list
// that keeps views and the permissions that guard them; `normalizeViewState` is the one check of
// what a view holds, so a saved view stays small and well-formed whichever client wrote it.
import { CONDITION_OPTIONS } from './conditions.mjs';

export const LIST_REPORTS = {
  'delivery.items': { view: 'delivery.item:view', save: 'delivery.view:save' },
};
export const MAX_VIEWS_PER_LIST = 50;
export const MAX_VIEW_NAME = 60;

const text = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');
const scalar = (value) =>
  typeof value === 'number' && Number.isFinite(value)
    ? value
    : typeof value === 'string'
      ? value.slice(0, 200)
      : null;

function ranges(value) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 200)
    .filter((r) => r && CONDITION_OPTIONS.includes(r.option))
    .map((r) => ({
      sign: r.sign === 'E' ? 'E' : 'I',
      option: r.option,
      low: scalar(r.low),
      high: scalar(r.high),
    }));
}

function columns(value) {
  if (!Array.isArray(value)) return null;
  return value
    .slice(0, 200)
    .filter((c) => c && typeof c.key === 'string')
    .map((c) => ({
      key: c.key.slice(0, 120),
      visible: c.visible !== false,
      ...(Number.isFinite(c.width) ? { width: Math.round(c.width) } : {}),
    }));
}

export function normalizeViewState(raw) {
  const state = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const conditions = {};
  for (const [key, value] of Object.entries(state.conditions ?? {}).slice(0, 100)) {
    const list = ranges(value);
    if (list.length) conditions[key.slice(0, 120)] = list;
  }
  return {
    search: text(state.search, 200),
    scope: text(state.scope, 40) || 'all',
    filterFields: Array.isArray(state.filterFields)
      ? state.filterFields
          .filter((k) => typeof k === 'string')
          .slice(0, 100)
          .map((k) => k.slice(0, 120))
      : [],
    conditions,
    columns: columns(state.columns),
    sortField: text(state.sortField, 120),
    sortOrder: state.sortOrder === 'asc' || state.sortOrder === 'desc' ? state.sortOrder : null,
  };
}
