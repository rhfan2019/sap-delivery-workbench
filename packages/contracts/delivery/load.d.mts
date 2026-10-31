import type { PhaseKey } from './fields.mjs';

interface PhaseLike {
  assigneeId: string | null;
  effortDays: number | null;
  plannedEnd: string | null;
  actualEnd: string | null;
  status: string;
}
interface ItemLike {
  phases: Record<PhaseKey, PhaseLike>;
}
export interface LoadBucket {
  effort: number;
  planned: number;
  actual: number;
}
export interface LoadRow {
  id: string | null;
  items: number;
  done: number;
  effort: number;
  unplanned: number;
  weeks: Record<string, LoadBucket>;
}
export interface LoadCell extends LoadBucket {
  diff: number;
}
export interface LoadColumns {
  before: LoadCell;
  weeks: (LoadCell & { monday: string })[];
  // From this Monday on.
  after: LoadCell & { from: string };
  total: LoadCell;
}

export const WEEKS_BEFORE: number;
export const AHEAD_DEFAULT: number;
export const AHEAD_MAX: number;
export function aheadOf(value: unknown): number;
export function mondayOf(date: string): string;
export function isoWeek(monday: string): string;
export function baseOptions(start: string | null, end: string | null, today: string): string[];
export function defaultBase(options: string[], today: string): string;
export function loadRows(items: ItemLike[]): {
  totals: { items: number; developed: number; tested: number };
  rows: LoadRow[];
};
export function loadWindow(row: LoadRow, base: string, ahead?: number): LoadColumns;
export function sumRows(rows: LoadRow[]): LoadRow;
