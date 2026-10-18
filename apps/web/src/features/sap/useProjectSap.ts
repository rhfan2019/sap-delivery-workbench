import { computed, ref, type Ref } from 'vue';
import { sapApi, type ProjectSystems, type SapSystem } from './api';

// The project's SAP systems and the user's login to each, shared by every control on the page
// (the system picker in the composer, the test data login), so logging in once updates all.
const views = new Map<string, Ref<ProjectSystems | null>>();
const loads = new Map<string, Promise<void>>();

export function useProjectSap(projectId: () => string) {
  const view = computed(() => {
    const id = projectId();
    if (!views.has(id)) views.set(id, ref(null));
    return views.get(id)!.value;
  });
  async function reload(force = false) {
    const id = projectId();
    if (!id) return;
    if (!views.has(id)) views.set(id, ref(null));
    if (!force && loads.has(id)) return loads.get(id);
    const load = sapApi
      .systems(id)
      .then((v) => {
        views.get(id)!.value = v;
      })
      .catch(() => {
        views.get(id)!.value = null;
      })
      .finally(() => loads.delete(id));
    loads.set(id, load);
    return load;
  }
  function adopt(next: ProjectSystems) {
    if (!views.has(next.projectId)) views.set(next.projectId, ref(null));
    views.get(next.projectId)!.value = next;
  }
  // The usable systems of a purpose, default first.
  const usable = (purpose?: 'development' | 'test'): SapSystem[] =>
    (view.value?.systems ?? [])
      .filter((s) => s.status === 'active' && s.canRead && (!purpose || s.purpose === purpose))
      .sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
  const defaultOf = (purpose: 'development' | 'test') =>
    view.value?.systems.find(
      (s) => s.purpose === purpose && s.isDefault && s.status === 'active',
    ) ?? null;
  return { view, reload, adopt, usable, defaultOf };
}
