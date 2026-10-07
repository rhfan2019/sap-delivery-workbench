import type { WorkbenchColumn } from './types';

/** Preserve requested widths; dedicate spare space to the primary identifier. */
export function layoutColumns(columns: WorkbenchColumn[], available: number) {
  const widths = columns.map((column) => ({
    ...column,
    width: Math.max(column.minWidth || 64, column.width || column.minWidth || 80),
  }));
  const flexible = widths.find((column) => column.flex);
  if (flexible) {
    const occupied = widths.reduce((sum, column) => sum + column.width, 44);
    flexible.width += Math.max(0, Math.floor(available) - occupied);
  }
  return widths;
}
