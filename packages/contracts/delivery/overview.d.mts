import type { PhaseKey } from './fields.mjs';

interface PhaseLike {
  assigneeId: string | null;
  effortDays: number | null;
  plannedStart: string | null;
  plannedEnd: string | null;
  actualEnd: string | null;
  status: string;
}
interface ItemLike {
  id: string;
  module: string;
  phases: Record<PhaseKey, PhaseLike>;
}
export type RiskSource = 'declared' | 'stale';
export type PlanGap = 'assignee' | 'dates' | 'effort';
export type Milestones = Partial<Record<string, string>>;
export interface OverviewFilter {
  ids?: string[];
  module?: string;
  awaiting?: boolean;
  phase?: PhaseKey;
  assignee?: string;
  status?: string;
  risk?: 'any' | RiskSource;
  due?: boolean;
  gap?: boolean;
  gate?: boolean;
}

export const RISK_SOURCES: Record<RiskSource, string>;
export const PHASE_GATES: Partial<Record<PhaseKey, string>>;
export const DUE_SOON_DAYS: number;
export const FILTER_KEYS: (keyof OverviewFilter)[];
export function isOpen(phase: PhaseLike): boolean;
export function addDays(date: string, days: number): string;
export function daysBetween(from: string, to: string): number;
export function phaseRisk(phase: PhaseLike, today: string): RiskSource | null;
export function riskPhases(item: ItemLike, today: string): PhaseKey[];
export function atRisk(item: ItemLike, today: string): boolean;
export function developmentDone(item: ItemLike): boolean;
export function scopeRemoved(item: ItemLike): boolean;
export function deliveryDone(item: ItemLike): boolean;
export function dueSoon(phase: PhaseLike, today: string, days?: number): boolean;
export function planGaps(item: ItemLike): { phase: PhaseKey; gap: PlanGap }[];
export function pastGate(item: ItemLike, phaseKey: PhaseKey, milestones: Milestones): boolean;
export function freezeRisk(item: ItemLike, today: string, milestones: Milestones): boolean;
export function awaitingTest(item: ItemLike): boolean;
export function handoverReady(item: ItemLike, fsdFinal: boolean): boolean;
export function reverseHandover(item: ItemLike, fsdFinal: boolean): boolean;
export function matchesFilter(
  item: ItemLike,
  filter: OverviewFilter,
  context?: { today?: string; milestones?: Milestones },
): boolean;
