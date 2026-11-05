import { computed, ref, watch } from 'vue';
import {
  DATE_PRESETS,
  matchesRanges,
  type ConditionRange,
  type Conditions,
} from '@sap-delivery-workbench/contracts/list-report/conditions';
import type {
  ColumnPreference,
  SavedView,
  ViewState,
} from '@sap-delivery-workbench/contracts/list-report/views';
import { api } from '../../services/session';
import type { ExtraFilter, ListField, ListReportOptions } from './types';

// The state and rules of one list report (docs/modules/list-report.md): filter bar, conditions,
// scope tabs, sorting, paging and saved views. No markup here; ListReport.vue draws it.
export function useListReport<T extends { id: string }>(o: ListReportOptions<T>) {
  const search = ref('');
  const scope = ref('all');
  const conditions = ref<Conditions>({});
  const filterFields = ref<string[]>([]);
  const sortField = ref('');
  const sortOrder = ref<'asc' | 'desc' | null>(null);
  const page = ref(1);
  const pageSize = ref(50);
  const layout = ref<ColumnPreference[] | null>(null);
  const shownKeys = ref<string[]>([]);
  const extra = ref<ExtraFilter<T> | null>(null);
  const views = ref<SavedView[]>([]);
  const canSave = ref(false);
  const viewId = ref('');
  // A view with 打开即应用 off shows its conditions and waits for 应用 before showing rows.
  const pending = ref(false);
  const barKey = 'list-report-bar:' + o.listKey;
  // Until the person chooses, a phone starts with the bar hidden: the table comes first there.
  const barOpen = ref(
    (read(() => localStorage.getItem(barKey)) ?? (window.innerWidth < 760 ? 'closed' : 'open')) ===
      'open',
  );
  watch(barOpen, (open) => read(() => localStorage.setItem(barKey, open ? 'open' : 'closed')));

  function read<R>(action: () => R): R | undefined {
    try {
      return action();
    } catch {
      return undefined; // Browser storage may be refused; the state then lasts for this page.
    }
  }

  const fieldOf = (key: string) => o.fields.value.find((f) => f.key === key);
  const defaultFields = () => o.fields.value.filter((f) => f.defaultFilter).map((f) => f.key);
  const standard = (): ViewState => ({
    search: '',
    scope: 'all',
    filterFields: defaultFields(),
    conditions: {},
    columns: null,
    sortField: '',
    sortOrder: null,
  });

  // --- filtering ------------------------------------------------------------------------------
  function passes(row: T, skip?: string) {
    const today = o.today();
    return Object.entries(conditions.value).every(([key, ranges]) => {
      if (key === skip) return true;
      const field = fieldOf(key);
      return !field || matchesRanges(field.value(row), ranges, today);
    });
  }
  function searched(row: T) {
    const q = search.value.trim().toLowerCase();
    return !q || o.searchText(row).toLowerCase().includes(q);
  }
  const scopeTest = computed(
    () => o.scopes.value.find((s) => s.id === scope.value)?.test ?? (() => true),
  );
  const matching = computed(() =>
    pending.value
      ? []
      : o.rows.value.filter(
          (row) => (!extra.value || extra.value.test(row)) && searched(row) && passes(row),
        ),
  );
  const filtered = computed(() => {
    const rows = matching.value.filter(scopeTest.value);
    if (!sortField.value || !sortOrder.value) return rows;
    const direction = sortOrder.value === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => o.compare(a, b, sortField.value) * direction);
  });
  const scopeTabs = computed(() =>
    o.scopes.value.map((s) => ({
      id: s.id,
      label: s.name,
      count: matching.value.filter(s.test).length,
    })),
  );
  const pages = computed(() => Math.max(1, Math.ceil(filtered.value.length / pageSize.value)));
  watch(pages, (n) => (page.value = Math.min(page.value, n)));
  const pageRows = computed(() =>
    filtered.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value),
  );
  // How many rows each choice of a field would find, given every other condition.
  function optionCounts(key: string) {
    const field = fieldOf(key);
    const counts = new Map<string, number>();
    if (!field) return counts;
    for (const row of o.rows.value) {
      if ((extra.value && !extra.value.test(row)) || !searched(row) || !passes(row, key)) continue;
      if (!scopeTest.value(row)) continue;
      const raw = field.value(row);
      const values = (Array.isArray(raw) ? raw : [raw]).filter(
        (v) => v !== null && v !== undefined && v !== '',
      );
      if (!values.length) counts.set('', (counts.get('') ?? 0) + 1);
      for (const value of values) counts.set(String(value), (counts.get(String(value)) ?? 0) + 1);
    }
    return counts;
  }

  // --- conditions -----------------------------------------------------------------------------
  function setRanges(key: string, ranges: ConditionRange[]) {
    const next = { ...conditions.value };
    if (ranges.length) next[key] = ranges;
    else delete next[key];
    conditions.value = next;
    if (ranges.length) addField(key);
  }
  // Every condition's field stays on the bar, so nothing narrows the list out of sight.
  function addField(key: string) {
    if (!filterFields.value.includes(key)) filterFields.value = [...filterFields.value, key];
  }
  function clearAll() {
    conditions.value = {};
    search.value = '';
    extra.value = null;
    pending.value = false;
  }
  function describe(field: ListField<T>, range: ConditionRange) {
    const prefix = range.sign === 'E' ? '≠ ' : '';
    switch (range.option) {
      case 'EQ':
        return (
          prefix +
          (field.options?.find((option) => option.value === String(range.low))?.label ??
            String(range.low))
        );
      case 'CP':
        return prefix + String(range.low);
      case 'EMPTY':
        return prefix + (field.emptyLabel ?? '未填写');
      case 'PRESET':
        return prefix + (DATE_PRESETS[String(range.low)] ?? String(range.low));
      case 'BT': {
        const low = range.low ?? '';
        const high = range.high ?? '';
        return prefix + (low && high ? `${low} ~ ${high}` : low ? `≥ ${low}` : `≤ ${high}`);
      }
    }
  }
  const tokens = (key: string) => {
    const field = fieldOf(key);
    return field
      ? (conditions.value[key] ?? []).map((range) => ({
          text: describe(field, range),
          exclude: range.sign === 'E',
        }))
      : [];
  };
  const activeFilters = computed(() => {
    const list: { key: string; label: string; clear: () => void }[] = [];
    if (extra.value)
      list.push({
        key: '_extra',
        label: extra.value.label,
        clear: () => (extra.value = null),
      });
    if (search.value)
      list.push({
        key: '_search',
        label: '搜索：' + search.value,
        clear: () => (search.value = ''),
      });
    for (const key of Object.keys(conditions.value)) {
      const field = fieldOf(key);
      if (field)
        list.push({
          key,
          label:
            field.label +
            '：' +
            tokens(key)
              .map((t) => t.text)
              .join('、'),
          clear: () => setRanges(key, []),
        });
    }
    return list;
  });
  const conditionCount = computed(
    () => activeFilters.value.filter((f) => !f.key.startsWith('_')).length,
  );

  // --- working state --------------------------------------------------------------------------
  const currentState = (): ViewState => ({
    search: search.value,
    scope: scope.value,
    filterFields: filterFields.value,
    conditions: conditions.value,
    columns: layout.value,
    sortField: sortField.value,
    sortOrder: sortOrder.value,
  });
  // What makes two states the same to the reader: widths don't count as a change to a view.
  function visibleColumns(columns: ColumnPreference[] | null) {
    const base = o.columns.value;
    const keys = [...new Set([...(columns ?? []).map((c) => c.key), ...base.map((c) => c.key)])];
    return keys.filter((key) => {
      const column = base.find((c) => c.key === key);
      if (!column) return false;
      if (column.required) return true;
      const saved = columns?.find((c) => c.key === key);
      return saved ? saved.visible : column.visible !== false;
    });
  }
  const signature = (state: ViewState) =>
    JSON.stringify([
      state.search,
      state.scope,
      state.filterFields,
      Object.keys(state.conditions)
        .sort()
        .map((key) => [key, state.conditions[key]]),
      visibleColumns(state.columns),
      state.sortOrder ? state.sortField : '',
      state.sortOrder,
    ]);
  const currentView = computed(() => views.value.find((v) => v.id === viewId.value) ?? null);
  const dirty = computed(
    () => signature(currentState()) !== signature(currentView.value?.state ?? standard()),
  );

  let restoring = false;
  // Set by a drill-down: this list's filters stand apart from the ones the reader keeps.
  let isolated = false;
  const queryKey = computed(() =>
    JSON.stringify([
      search.value,
      scope.value,
      conditions.value,
      filterFields.value,
      sortField.value,
      sortOrder.value,
      pageSize.value,
      viewId.value,
    ]),
  );
  watch(
    queryKey,
    () => {
      if (restoring) return;
      page.value = 1;
      if (isolated) return;
      read(() =>
        sessionStorage.setItem(
          o.stateKey(),
          JSON.stringify({
            viewId: viewId.value,
            search: search.value,
            scope: scope.value,
            conditions: conditions.value,
            filterFields: filterFields.value,
            sortField: sortField.value,
            sortOrder: sortOrder.value,
            pageSize: pageSize.value,
          }),
        ),
      );
    },
    { flush: 'sync' },
  );
  function applyState(state: ViewState) {
    restoring = true;
    search.value = state.search;
    scope.value = state.scope;
    conditions.value = state.conditions;
    filterFields.value = state.filterFields.length ? state.filterFields : defaultFields();
    sortField.value = state.sortField;
    sortOrder.value = state.sortOrder;
    page.value = 1;
    restoring = false;
  }
  function setLayout(next: ColumnPreference[]) {
    layout.value = next;
    read(() => localStorage.setItem(o.layoutKey(), JSON.stringify(next)));
  }
  function savedLayout(): ColumnPreference[] | null {
    const value = read(() => JSON.parse(localStorage.getItem(o.layoutKey()) || 'null'));
    return Array.isArray(value) ? value : null;
  }
  function savedSession() {
    const value = read(() => JSON.parse(sessionStorage.getItem(o.stateKey()) || 'null'));
    return value && typeof value === 'object' ? value : null;
  }

  // Opening the list for a person and project: where they left it this session, else their default
  // view, else the standard view with the columns this browser remembers.
  function enter() {
    const saved = isolated ? null : savedSession();
    viewId.value = '';
    pending.value = false;
    views.value = [];
    canSave.value = false;
    layout.value = savedLayout();
    restoring = true;
    pageSize.value = [20, 50, 100].includes(saved?.pageSize) ? saved.pageSize : 50;
    restoring = false;
    if (saved) {
      applyState({ ...standard(), ...saved, columns: null });
      restoring = true;
      viewId.value = typeof saved.viewId === 'string' ? saved.viewId : '';
      restoring = false;
    } else applyState(standard());
    void loadViews(!saved && !isolated);
  }
  // A drill-down opens on nothing but its own filter; the reader's filters are left where they are.
  function drill(filter: ExtraFilter<T>) {
    isolated = true;
    viewId.value = '';
    applyState(standard());
    extra.value = filter;
  }

  // --- saved views ----------------------------------------------------------------------------
  const viewsError = ref('');
  let viewsRequest = 0;
  async function loadViews(applyDefault = false) {
    const url = o.viewsUrl();
    const request = ++viewsRequest;
    const before = queryKey.value;
    viewsError.value = '';
    if (!url) return;
    try {
      const result = await api<{ views: SavedView[]; canSave: boolean }>(url);
      if (request !== viewsRequest) return;
      views.value = Array.isArray(result?.views) ? result.views : [];
      canSave.value = result?.canSave === true;
      if (viewId.value && !currentView.value) viewId.value = '';
      const preferred = views.value.find((v) => v.isDefault);
      // Only if nothing was touched while the views were on their way.
      if (applyDefault && preferred && queryKey.value === before) openView(preferred.id);
    } catch (e) {
      if (request === viewsRequest) viewsError.value = (e as Error).message;
    }
  }
  function openView(id: string) {
    const view = views.value.find((v) => v.id === id) ?? null;
    extra.value = null;
    pending.value = view ? !view.autoApply : false;
    applyState(view?.state ?? standard());
    layout.value = view?.state.columns ?? null;
    viewId.value = id;
    page.value = 1;
  }
  const apply = () => (pending.value = false);
  async function saveCurrent() {
    if (!viewId.value) return;
    await api(`${o.viewsUrl()}/${viewId.value}`, { state: currentState() }, 'PATCH');
    await loadViews();
  }
  async function saveAs(input: { name: string; isDefault: boolean; autoApply: boolean }) {
    const view = await api<SavedView>(o.viewsUrl()!, { ...input, state: currentState() });
    await loadViews();
    viewId.value = view.id;
  }
  async function updateView(
    id: string,
    changes: Partial<Pick<SavedView, 'name' | 'isDefault' | 'autoApply'>>,
  ) {
    await api(`${o.viewsUrl()}/${id}`, changes, 'PATCH');
    await loadViews();
  }
  async function removeView(id: string) {
    await api(`${o.viewsUrl()}/${id}`, {}, 'DELETE');
    if (viewId.value === id) viewId.value = '';
    await loadViews();
  }
  const isStandardDefault = computed(() => !views.value.some((v) => v.isDefault));

  return {
    listKey: o.listKey,
    fields: o.fields,
    columns: o.columns,
    search,
    scope,
    scopeTabs,
    conditions,
    filterFields,
    sortField,
    sortOrder,
    page,
    pageSize,
    pages,
    layout,
    shownKeys,
    extra,
    views,
    canSave,
    viewId,
    currentView,
    dirty,
    pending,
    barOpen,
    filtered,
    pageRows,
    activeFilters,
    conditionCount,
    viewsError,
    isStandardDefault,
    queryKey,
    fieldOf,
    defaultFields,
    optionCounts,
    setRanges,
    addField,
    clearAll,
    tokens,
    setLayout,
    enter,
    drill,
    openView,
    apply,
    saveCurrent,
    saveAs,
    updateView,
    removeView,
  };
}
export type ListReportApi<T extends { id: string }> = ReturnType<typeof useListReport<T>>;
