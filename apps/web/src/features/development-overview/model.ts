import type { Router } from 'vue-router';
import { openInNewTab } from '../../services/tabs';
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
export interface SapObject {
  pgmid: string;
  objectType: string;
  objectName: string;
}
export interface Readiness {
  total: number;
  ready: number;
  notReady: string[];
}
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
    handover: (Brief & {
      finalOn: string;
      estimated: boolean;
      waitDays: number;
      objects: (SapObject & { shared: Brief[] })[];
    })[];
    reverse: Brief[];
    conflicts: { pgmid: string; objectType: string; objectName: string; items: Brief[] }[];
    awaitingTest: (Brief & { waitDays: number | null; tester: string | null })[];
    fsdFinal: {
      total: number;
      final: number;
      byModule: Record<string, { total: number; final: number }>;
    };
    gates: Partial<Record<PhaseKey, number>>;
    aging: Record<
      PhaseKey,
      {
        points: (Brief & { days: number; estimated: boolean })[];
        p50: number | null;
        p85: number | null;
      }
    >;
    coverage: { started: number; session: number; final: number; sap: number; missing: Brief[] };
    rework: (Brief & { laterVersions: number; retest: boolean })[];
    comments: {
      open: number;
      ages: { within3: number; within7: number; older: number };
      oldest: (Brief & { source: 'fsd' | 'dev'; days: number })[];
      resolvedMedian: number | null;
      itemIds: string[];
    };
  };
  fsdBacklog: { overdue: string[]; week: string[]; later: string[]; unplanned: string[] };
  readiness: {
    all: Readiness;
    byModule: Record<string, Readiness>;
    noTester: string[];
  };
  mine: {
    today: (Brief & {
      phase: PhaseKey;
      status: string;
      plannedEnd: string | null;
      risk: RiskSource | null;
      stage: 'design' | 'development' | null;
    })[];
    todoTotal: number;
    todoIds: string[];
    respond: (Brief & { type: 'comment' | 'final'; source?: 'fsd' | 'dev'; days: number })[];
    objects: (SapObject & { item: Brief; shared: Brief[] })[];
  };
  consultant: { fsdRisk: string[]; comments: string[]; awaiting: string[] };
  people: { id: string; name: string }[];
  flow: Flow;
  sitForecast: {
    sit: string;
    slip: { days: number; samples: number };
    all: Forecast;
    byModule: Record<string, Forecast>;
  } | null;
  week: {
    from: string;
    to: string;
    completed: (Brief & { phase: PhaseKey })[];
    created: Brief[];
    pushed: (Brief & { phase: PhaseKey; days: number })[];
    due: (Brief & { phase: PhaseKey; plannedEnd: string })[];
  };
  planDrift: {
    planned: number;
    drifted: number;
    totalDays: number;
    top: (Brief & { phase: PhaseKey; baselineEnd: string; plannedEnd: string; days: number })[];
    itemIds: string[];
  };
  freshness: { lastOn: string | null; days: number | null };
  guards: {
    reopened: number;
    reopenedIds: string[];
    effortMedian: { recent: number | null; earlier: number | null };
  };
  signal: Signal;
  budget?: { budgetDays: number | null; plannedDays: number; doneDays: number };
}

export interface Flow {
  days: string[];
  status: Record<PhaseKey, Record<string, number[]>>;
  remaining: number[];
  freeze: string | null;
  ideal: { from: { date: string; value: number }; to: { date: string; value: number } } | null;
  pace: {
    remaining: number;
    weeksLeft: number | null;
    requiredPerWeek: number | null;
    recentPerWeek: number;
    lastWeeks: number[];
  };
}
export interface Forecast {
  total: number;
  readyNow: number;
  predicted: number;
  missing: string[];
}
export type Health = 'green' | 'yellow' | 'red';
export interface Signal {
  color: Health;
  reasons: { level: 'yellow' | 'red'; text: string }[];
}
// GET /development-portfolio (spec section 2, delivery director and PMO).
export interface PortfolioRow {
  id: string;
  code: string;
  name: string;
  items: number;
  risk: number;
  stale: number;
  developmentDone: number;
  freeze: { date: string | null; achieved: boolean; days: number | null };
  freezeLate: number;
  goLive: string | null;
  budget: { budgetDays: number | null; plannedDays: number } | null;
  lastOn: string | null;
  staleDays: number | null;
  reported: { overall: Health; reportedOn: string } | null;
  signal: Signal;
}
export const HEALTH: Record<Health, string> = { green: '正常', yellow: '关注', red: '风险' };

export type ViewId = 'project' | 'team' | 'mine' | 'consultant' | 'tester' | 'portfolio';
export const VIEWS: { id: ViewId; label: string }[] = [
  { id: 'project', label: '项目' },
  { id: 'team', label: '开发组' },
  { id: 'mine', label: '我的' },
  { id: 'consultant', label: '顾问' },
  { id: 'tester', label: '测试' },
  { id: 'portfolio', label: '项目组合' },
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
export const assistantLink = (project: string, id: string, stage: 'design' | 'development') =>
  `/projects/${project}/development-items/${id}/${stage}`;
export const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);
export const shortDate = (date: string) => date.slice(5).replace('-', '/');

// Everything opened from the overview gets its own tab, so the overview stays where it was.
export async function openFrom(router: Router, path: string) {
  if (!(await openInNewTab(path))) await router.push(path);
}
