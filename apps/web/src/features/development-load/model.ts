import type { OverviewFilter } from '@sap-delivery-workbench/contracts/delivery/overview';
import type { LoadRow } from '@sap-delivery-workbench/contracts/delivery/load';

// GET /api/projects/:projectId/development-load (docs/specs/development-load.md).
export interface LoadPerson {
  id: string;
  name: string;
  active: boolean;
  sortCode: number | null;
}
export interface DevelopmentLoad {
  today: string;
  project: { start: string | null; end: string | null };
  options: string[];
  base: string;
  totals: { items: number; developed: number; tested: number };
  people: LoadPerson[];
  rows: LoadRow[];
}

// The development list filtered to what one number counted (only the development phase).
export function loadLink(project: string, filter: OverviewFilter, label: string) {
  const query = new URLSearchParams({ from: 'load', project, label, phase: 'development' });
  for (const [key, value] of Object.entries(filter))
    if (value !== undefined && value !== false)
      query.set(key, value === true ? '1' : String(value));
  return '/workspace/development-items?' + query.toString();
}
export const shortDate = (date: string) => date.slice(5).replace('-', '/');
export const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);
