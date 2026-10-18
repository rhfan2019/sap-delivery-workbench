export declare const PROJECT_TYPES: Record<
  'implementation' | 'rollout' | 'upgrade' | 'conversion' | 'enhancement' | 'support' | 'migration' | 'other',
  string
>;
export declare const PROJECT_STATUSES: Record<'preparing' | 'active' | 'live' | 'completed' | 'archived', string>;
export declare const METHODOLOGIES: Record<'activate' | 'asap' | 'agile' | 'hybrid', string>;
export declare const CONTRACT_ROLES: Record<'prime' | 'subcontract' | 'direct', string>;
export declare const SAP_PRODUCTS: Record<
  'ecc' | 's4_onpremise' | 's4_private' | 's4_public' | 'bw4' | 'other',
  string
>;
export declare const DEPLOYMENTS: Record<'on_premise' | 'private_cloud' | 'public_cloud', string>;
export declare const SAP_MODULES: string[];
export declare const TRANSPORT_METHODS: Record<'charm' | 'manual', string>;
export declare const CONTRACT_MODELS: Record<'fixed' | 'per_day' | 'time_material', string>;
export declare const KEY_ROLES: Record<'manager' | 'director' | 'architect' | 'devLead' | 'basisLead', string>;
export declare const PHASES: { key: string; name: string }[];
export declare const PHASE_STATUSES: Record<'not_started' | 'in_progress' | 'completed', string>;
export declare const MILESTONES: { key: string; name: string; phase: string }[];
export type MilestoneState = 'achieved' | 'delayed' | 'due' | 'upcoming' | 'unplanned';
export declare function milestoneState(
  m: { achievedOn?: string | null; plannedOn?: string | null },
  today?: string,
): MilestoneState;
export declare const MILESTONE_STATES: Record<MilestoneState, string>;
export declare const CONTACT_ROLES: Record<
  'customer_pm' | 'it_lead' | 'business_owner' | 'key_user' | 'other',
  string
>;
export declare const HEALTH: Record<'green' | 'yellow' | 'red', string>;
export declare const HEALTH_DIMENSIONS: Record<'schedule' | 'scope' | 'cost' | 'quality', string>;
export declare const HEALTH_STALE_DAYS: number;
