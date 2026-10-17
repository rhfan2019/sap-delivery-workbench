import { createRouter, createWebHistory } from 'vue-router';
import { identity, restoreSession } from '../services/session';
import LoginView from '../views/LoginView.vue';
import PasswordView from '../views/PasswordView.vue';
import AppLayout from '../components/AppLayout.vue';
import WorkspaceView from '../views/WorkspaceView.vue';
export const router = createRouter({
  history: createWebHistory(),
  scrollBehavior: () => ({ top: 0, left: 0 }),
  routes: [
    { path: '/login', component: LoginView },
    { path: '/password', component: PasswordView },
    {
      path: '/',
      component: AppLayout,
      children: [
        { path: '', redirect: '/home' },
        { path: 'home', component: WorkspaceView },
        { path: 'projects/:id?', component: WorkspaceView },
        {
          path: 'projects/:projectId/development-items/:itemId/design',
          component: () => import('../features/abap-fsd-agent/ItemWorkspaceRoute.vue'),
          // ?session= switches the conversation inside the view; it must not remount it.
          meta: { keepOnQuery: true },
        },
        {
          path: 'projects/:projectId/development-items/:itemId/development',
          component: () => import('../features/abap-dev-agent/ItemWorkspaceRoute.vue'),
          // ?session= switches the conversation inside the view; it must not remount it.
          meta: { keepOnQuery: true },
        },
        {
          path: 'workspace/organization',
          component: () => import('../features/admin/OrganizationView.vue'),
        },
        {
          path: 'workspace/organization-profile',
          component: () => import('../features/admin/OrganizationProfileView.vue'),
        },
        { path: 'workspace/members', component: () => import('../features/admin/MembersView.vue') },
        { path: 'workspace/models', component: () => import('../features/models/ModelsView.vue') },
        {
          path: 'workspace/connections',
          component: () => import('../features/sap/SapSystemsView.vue'),
        },
        {
          path: 'workspace/technical-verification',
          component: () => import('../features/admin/TechnicalVerificationView.vue'),
        },
        {
          path: 'workspace/development-items',
          component: () => import('../features/delivery/DeliveryView.vue'),
        },
        {
          path: 'workspace/audit',
          component: () => import('../features/audit/AuditView.vue'),
        },
        {
          path: 'workspace/audit/runs/:id',
          component: () => import('../features/audit/AuditRunView.vue'),
        },
        {
          path: 'workspace/audit/sessions/:id',
          component: () => import('../features/audit/AuditSessionView.vue'),
        },
        { path: 'workspace/:module', component: WorkspaceView },
        { path: 'settings', component: () => import('../views/SettingsView.vue') },
        { path: ':pathMatch(.*)*', component: WorkspaceView },
      ],
    },
  ],
});
router.beforeEach(async (to) => {
  if (!identity.value && to.path !== '/login') {
    try {
      await restoreSession();
    } catch {
      return { path: '/login', query: { unavailable: '1' } };
    }
  }
  if (!identity.value && to.path !== '/login') return '/login';
  if (identity.value?.mustChangePassword && to.path !== '/password') return '/password';
  if (
    identity.value &&
    !identity.value.mustChangePassword &&
    ['/login', '/password'].includes(to.path)
  )
    return '/home';
});
// A lazy page whose module cannot be fetched (a dev server that re-bundled its dependencies, or a
// deploy that replaced the chunks) would otherwise leave the click doing nothing: load the page
// afresh instead, once per target so a real outage does not loop.
router.onError((error, to) => {
  if (!/dynamically imported module|Importing a module script failed/i.test(String(error))) return;
  const key = `reload:${to.fullPath}`;
  if (sessionStorage.getItem(key)) return;
  sessionStorage.setItem(key, '1');
  window.location.assign(to.fullPath);
});
router.afterEach((to) => sessionStorage.removeItem(`reload:${to.fullPath}`));
