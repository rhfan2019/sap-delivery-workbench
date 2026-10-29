import { onActivated, onDeactivated, onMounted, onUnmounted } from 'vue';
import { onBeforeRouteLeave } from 'vue-router';
import { leaveDelivery } from '../../services/projectContext';
import { switchingTab, useTabLeave } from '../../services/tabs';

// A settings list whose drawer may hold unsaved changes (DESIGN.md 5 “抽屉”): leaving the page,
// closing its tab, switching project or signing out asks first; bringing another tab forward
// keeps the page as it is (docs/specs/workbench-tabs.md 4, 5). `dirty` also guards a reload.
export function useDrawerLeave(canLeave: () => Promise<boolean>, dirty: () => boolean) {
  onBeforeRouteLeave(() => switchingTab() || canLeave());
  useTabLeave(canLeave);
  leaveDelivery.value = canLeave;
  const release = () => {
    if (leaveDelivery.value === canLeave) leaveDelivery.value = null;
  };
  onActivated(() => (leaveDelivery.value = canLeave));
  onDeactivated(release);
  function unload(e: BeforeUnloadEvent) {
    if (!dirty()) return;
    e.preventDefault();
    e.returnValue = '';
  }
  onMounted(() => window.addEventListener('beforeunload', unload));
  onUnmounted(() => {
    window.removeEventListener('beforeunload', unload);
    release();
  });
}
