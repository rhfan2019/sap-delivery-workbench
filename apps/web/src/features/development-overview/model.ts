import type {
  OverviewFilter,
  RiskSource,
} from '@sap-delivery-workbench/contracts/delivery/overview';
import type { PhaseKey } from '@sap-delivery-workbench/contracts/delivery/fields';

// The response of GET /projects/:id/development-overview (docs/specs/development-overview.md 7).
export interface Brief {
  id: string;
  code: string;
  name: string;
  module: string;
}
export type Reason =
  | {
      type: 'risk';
      phase: PhaseKey;
      source: RiskSource;
      days: number | null;
      assignee: string | null;
    }
  | { type: 'idle'; days: number }
  | { type: 'drift'; phase: PhaseKey; days: number };
export interface Milestone {
  key: string;
  name: string;
  plannedOn: string | null;
  achievedOn: string | null;
}
export interface Card {
  count: number;
  filter: OverviewFilter;
}
export interface Overview {
  today: string;
  view: ViewId;
  team: boolean;
  commercial: boolean;
  scope: OverviewFilter;
  milestones: Milestone[];
  modules: string[];
  counts: { items: number; removed: number; developmentDone: number; deliveryDone: number };
  cards: {
    risk: Card & { declared: number; stale: number };
    dueSoon: Card;
    freeze: Card & {
      date: string | null;
      daysLeft: number | null;
      risk: number;
      riskFilter: OverviewFilter;
    };
    gaps: Card & { assignee: number; dates: number; effort: number };
  };
  matrix: Record<PhaseKey, Record<string, number>>;
  moduleMatrix: Record<
    string,
    Record<PhaseKey, { total: number; completed: number; risk: number }>
  >;
  attention: (Brief & { reasons: Reason[] })[];
  attentionTotal: number;
  load: {
    weeks: string[];
    rows: { userId: string | null; name: string; open: number; days: number[] }[];
  };
  development: {
    handover: (Brief & { finalOn: string; waitDays: number })[];
    reverse: Brief[];
    conflicts: { pgmid: string; objectType: string; objectName: string; items: Brief[] }[];
    awaitingTest: (Brief & { waitDays: number | null; tester: string | null })[];
    fsdFinal: {
      total: number;
      final: number;
      byModule: Record<string, { total: number; final: number }>;
    };
    gates: Partial<Record<PhaseKey, number>>;
  };
  budget?: { budgetDays: number | null; plannedDays: number; doneDays: number };
}

export type ViewId = 'project' | 'team' | 'mine' | 'consultant' | 'tester';
export const VIEWS: { id: ViewId; label: string; ready: boolean }[] = [
  { id: 'project', label: '项目', ready: true },
  { id: 'team', label: '开发组', ready: true },
  { id: 'mine', label: '我的', ready: false },
  { id: 'consultant', label: '顾问', ready: false },
  { id: 'tester', label: '测试', ready: false },
];

// The list address for a drill-down (spec section 8): the viewer's scope is added, so the
// list shows exactly the items the number counted.
export function drillLink(
  project: string,
  filter: OverviewFilter,
  label: string,
  scope: OverviewFilter,
) {
  const query = new URLSearchParams({ from: 'overview', project, label });
  for (const [key, value] of Object.entries({ ...filter, ...scope })) {
    if (value === undefined || value === false) continue;
    query.set(key, Array.isArray(value) ? value.join(',') : value === true ? '1' : String(value));
  }
  return '/workspace/development-items?' + query.toString();
}
export const itemLink = (project: string, id: string) =>
  `/workspace/development-items?project=${project}&item=${id}`;
export const shortDate = (date: string) => date.slice(5).replace('-', '/');
