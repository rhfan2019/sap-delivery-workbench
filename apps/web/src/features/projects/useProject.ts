import { computed, ref, watch } from 'vue';
import { api, identity, type ProjectAccess } from '../../services/session';
import { currentProject, loadProjects } from '../../services/projectContext';
import { allows } from '../access/permissions';

// The current project's master data (GET /api/projects/:id) for the project settings pages,
// reloaded when the user switches project in the menu.
export interface Phase {
  key: string;
  name: string;
  sort: number;
  plannedStart: string | null;
  plannedEnd: string | null;
  actualStart: string | null;
  actualEnd: string | null;
  status: string;
  rowVersion: string;
}
export interface Milestone {
  id: string;
  key: string | null;
  name: string;
  phaseKey: string | null;
  plannedOn: string | null;
  achievedOn: string | null;
  notes: string;
  rowVersion: string;
}
export interface Contact {
  id: string;
  name: string;
  title: string;
  department: string;
  contactRole: string;
  modules: string[];
  phone: string;
  email: string;
  notes: string;
  hidden?: boolean;
  rowVersion: string;
}
export interface HealthReport {
  id: string;
  reportedOn: string;
  overall: string;
  schedule: string;
  scope: string;
  cost: string;
  quality: string;
  note: string;
  reportedBy: string;
}
export interface ProjectDetail {
  id: string;
  code: string;
  name: string;
  shortName: string;
  customerId: string;
  customerName: string;
  projectType: string;
  status: string;
  isPaused: boolean;
  description: string | null;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  methodology: string;
  contractRole: string;
  primeContractor: string;
  sapProduct: string | null;
  sapRelease: string;
  deployment: string | null;
  modules: string[];
  language: string;
  namespace: string;
  defaultPackage: string;
  transportMethod: string | null;
  contractNo?: string;
  contractModel?: string | null;
  contractDays?: number | null;
  devBudgetDays?: number | null;
  teamSize?: number | null;
  plannedDays?: number;
  keyRoles: Record<string, { id: string; displayName: string } | null>;
  phases: Phase[];
  currentPhase: string | null;
  milestones: Milestone[];
  moduleLeads: { module: string; userId: string; displayName: string }[];
  contacts: Contact[];
  health: HealthReport[];
  healthStale: boolean;
  members: { id: string; displayName: string }[];
  access: ProjectAccess;
  rowVersion: string;
}

export function useProject() {
  const project = ref<ProjectDetail | null>(null);
  const loading = ref(false);
  const error = ref('');
  let request = 0;
  async function reload() {
    const id = currentProject.value;
    const mine = ++request;
    error.value = '';
    if (!id) {
      project.value = null;
      return;
    }
    loading.value = true;
    try {
      const data = await api<ProjectDetail>('/projects/' + id);
      if (mine === request) project.value = data;
    } catch (e) {
      if (mine === request) error.value = (e as Error).message;
    } finally {
      if (mine === request) loading.value = false;
    }
  }
  // After a save the API answers with the whole project; the menu's names may have changed.
  function replace(next: ProjectDetail) {
    project.value = next;
    void loadProjects();
  }
  watch(currentProject, reload, { immediate: true });
  const can = (code: string) =>
    allows(project.value?.access, code, undefined, identity.value?.user.id);
  const readOnly = computed(() => project.value?.status === 'archived');
  return { project, loading, error, reload, replace, can, readOnly };
}
