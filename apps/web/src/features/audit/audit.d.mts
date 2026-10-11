export const STATUS_LABELS: Record<string, string>;
export function statusLabel(status: string | null | undefined): string;
export function statusTone(status: string | null | undefined): 'danger' | 'warn' | 'ok' | 'muted';
export const STOP_REASONS: Record<string, string>;
export function stopReasonLabel(reason: string | null | undefined): string;
export const TOOL_LABELS: Record<string, string>;
export function toolLabel(name: string): string;
export const FILTER_KEYS: readonly string[];
export const LONG_GAP_MS: number;
export const ALERT_GAP_MS: number;
export function formatDuration(ms: number | null | undefined): string;
export function formatTokens(n: number | null | undefined): string;
export function formatPercent(ratio: number | null | undefined): string;
export function gapLevel(ms: number): 'none' | 'warn' | 'alert';
export function pickFilters(query?: Record<string, unknown>): Record<string, string>;
export function toQueryString(params?: Record<string, unknown>): string;
export function presetRange(preset: string, now?: Date): { from: string; to: string } | null;
export function withGrowth<T extends Record<string, any>>(
  rounds: T[],
  threshold?: number,
): (T & {
  tokens: number;
  duration_change: number | null;
  token_change: number | null;
  flagged: boolean;
})[];
export function sparkPoints(
  values: (number | null)[],
  width: number,
  height: number,
  pad?: number,
): [number, number][];
