import type { Conditions } from './conditions.mjs';

export interface ColumnPreference {
  key: string;
  visible: boolean;
  width?: number;
}
export interface ViewState {
  search: string;
  scope: string;
  filterFields: string[];
  conditions: Conditions;
  /** null: the list's default columns. */
  columns: ColumnPreference[] | null;
  sortField: string;
  sortOrder: 'asc' | 'desc' | null;
}
export interface SavedView {
  id: string;
  name: string;
  isDefault: boolean;
  autoApply: boolean;
  state: ViewState;
}
export declare const LIST_REPORTS: Record<string, { view: string; save: string }>;
export declare const MAX_VIEWS_PER_LIST: number;
export declare const MAX_VIEW_NAME: number;
export declare function normalizeViewState(raw: unknown): ViewState;
