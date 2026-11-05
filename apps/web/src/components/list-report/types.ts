import type { ComputedRef, Ref } from 'vue';
import type { WorkbenchColumn } from '../workbench-table/types';

// What a page declares about its list (docs/modules/list-report.md 2).
export type ListFieldType = 'select' | 'text' | 'date' | 'number';
export interface ListFieldOption {
  value: string;
  label: string;
}
export interface ListField<T> {
  key: string;
  label: string;
  /** Heading the field sits under in 适配筛选. */
  group: string;
  type: ListFieldType;
  options?: ListFieldOption[];
  /** Offers “no value” as a choice under this name, such as 未分配. */
  emptyLabel?: string;
  /** Shown on the filter bar in the standard view. */
  defaultFilter?: boolean;
  /** The value on a row; a list for multi-valued fields. */
  value: (row: T) => unknown;
}
export interface ListScope<T> {
  id: string;
  name: string;
  test: (row: T) => boolean;
}
/** A filter from outside the bar, such as a drill-down: applied on top and never saved. */
export interface ExtraFilter<T> {
  label: string;
  test: (row: T) => boolean;
}
export interface ListReportOptions<T> {
  listKey: string;
  rows: Ref<T[]>;
  fields: ComputedRef<ListField<T>[]>;
  columns: ComputedRef<WorkbenchColumn[]>;
  scopes: ComputedRef<ListScope<T>[]>;
  searchText: (row: T) => string;
  compare: (a: T, b: T, key: string) => number;
  today: () => string;
  /** Where the working state lasts for the session (per person and project). */
  stateKey: () => string;
  /** Where the column layout lasts on this browser (per person and project). */
  layoutKey: () => string;
  /** The saved views' address; null while no project is chosen. */
  viewsUrl: () => string | null;
}
