export type ConditionOption = 'EQ' | 'CP' | 'BT' | 'EMPTY' | 'PRESET';
export interface ConditionRange {
  sign: 'I' | 'E';
  option: ConditionOption;
  low?: string | number | null;
  high?: string | number | null;
}
export type Conditions = Record<string, ConditionRange[]>;
export declare const CONDITION_OPTIONS: ConditionOption[];
export declare const DATE_PRESETS: Record<string, string>;
export declare function presetRange(
  preset: string,
  today: string,
): { from: string; to: string } | null;
export declare function matchesRanges(
  value: unknown,
  ranges: ConditionRange[] | undefined,
  today: string,
): boolean;
