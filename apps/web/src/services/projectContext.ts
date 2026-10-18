import { ref, watch } from 'vue';
import { api, identity, type Project, type ProjectAccess } from './session';
export const projects = ref<Project[]>([]);
export const currentProject = ref('');
// The user's permissions in the current project, for menus and buttons (contract 3.5).
export const projectAccess = ref<ProjectAccess | null>(null);
let accessRequest = 0;
export async function loadProjectAccess() {
  const id = currentProject.value;
  const request = ++accessRequest;
  if (!id) {
    projectAccess.value = null;
    return;
  }
  try {
    const access = await api<ProjectAccess>(`/projects/${id}/access`);
    if (request === accessRequest) projectAccess.value = access;
  } catch {
    if (request === accessRequest) projectAccess.value = null;
  }
}
watch(currentProject, () => void loadProjectAccess());
export const defaultProject = ref<string | null>(null);
export const projectError = ref('');
export const leaveDelivery = ref<null | (() => Promise<boolean>)>(null);
let owner = '';
export async function loadProjects() {
  const user = identity.value?.user.id ?? '';
  if (owner !== user) {
    currentProject.value = '';
    defaultProject.value = null;
    owner = user;
  }
  try {
    const [list, preference] = await Promise.all([
      api<Project[]>('/projects'),
      api<{ projectId: string | null }>('/project-preference'),
    ]);
    projects.value = list;
    defaultProject.value = preference.projectId;
    if (!list.some((p) => p.id === currentProject.value))
      currentProject.value = preference.projectId ?? (list.length === 1 ? list[0]!.id : '');
    projectError.value = '';
  } catch (e) {
    projectError.value = (e as Error).message;
  }
}
export async function selectProject(id: string) {
  if (id === currentProject.value) return;
  if (leaveDelivery.value && !(await leaveDelivery.value())) return;
  currentProject.value = id;
}
export async function setDefaultProject() {
  const requested = currentProject.value || null;
  try {
    await api('/project-preference', { projectId: requested });
    defaultProject.value = requested;
    projectError.value = '';
  } catch (e) {
    projectError.value = (e as Error).message;
  }
}
