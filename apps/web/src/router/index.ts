import { createRouter, createWebHistory } from 'vue-router';
import { identity, restoreSession } from '../services/session';
import LoginView from '../views/LoginView.vue';
import PasswordView from '../views/PasswordView.vue';
import AppLayout from '../components/AppLayout.vue';
import WorkspaceView from '../views/WorkspaceView.vue';
const page = <T>(path: string, component: () => Promise<T>) => ({ path, component });
const settingsRoutes = [
  page('settings', () => import('../features/settings/SettingsOverview.vue')),
  page('settings/profile', () => import('../features/settings/ProfileView.vue')),
  page('settings/sap-credentials', () => import('../features/sap/MySapCredentialsView.vue')),
  page('settings/project/general', () => import('../features/projects/ProjectGeneralView.vue')),
  page('settings/project/plan', () => import('../features/projects/ProjectPlanView.vue')),
  page('settings/project/team', () => import('../features/projects/ProjectTeamView.vue')),
  page('settings/project/members', () => import('../features/access/ProjectMembersView.vue')),
  page('settings/project/sap', () => import('../features/sap/ProjectSapView.vue')),
  page(
    'settings/project/commercial',
    () => import('../features/projects/ProjectCommercialView.vue'),
  ),
  page('settings/organization', () => import('../features/admin/OrganizationView.vue')),
  page('settings/customers', () => import('../features/admin/CustomersView.vue')),
  page('settings/projects', () => import('../features/admin/ProjectsView.vue')),
  page('settings/users', () => import('../features/admin/UsersView.vue')),
  page('settings/positions', () => import('../features/access/PositionsView.vue')),
  page('settings/roles', () => import('../features/access/RolesView.vue')),
  page('settings/security', () => import('../features/sap/SecurityPolicyView.vue')),
  page('settings/models', () => import('../features/models/ModelsView.vue')),
  page('settings/audit', () => import('../features/audit/AuditView.vue')),
  page('settings/audit/runs/:id', () => import('../features/audit/AuditRunView.vue')),
  page('settings/audit/sessions/:id', () => import('../features/audit/AuditSessionView.vue')),
  page('settings/sap-directory', () => import('../features/sap/SapDirectoryView.vue')),
  page('settings/diagnostics', () => import('../features/admin/TechnicalVerificationView.vue')),
];
export const router = createRouter({
  history: createWebHistory(),
  scrollBehavior: () => ({ top: 0, left: 0 }),
  routes: [
    { path: '/login', component: LoginView },
    { path: '/password', component: PasswordView },
    // Development only: every base component and state (contract 1.15).
    ...(import.meta.env.DEV
      ? [
          {
            path: '/dev/components',
            component: () => import('../views/ComponentGalleryView.vue'),
            meta: { public: true },
          },
        ]
      : []),
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
          path: 'workspace/development-items',
          component: () => import('../features/delivery/DeliveryView.vue'),
          // ?project=&item= names the open drawer (kept in sync); &section= is read once.
          meta: { keepOnQuery: true },
        },
        { path: 'workspace/:module', component: WorkspaceView },
        // Settings (docs/specs/project-access-admin.md 4.3). Planned entries have no route here:
        // they fall through to WorkspaceView, which shows the shared “规划中” page.
        ...settingsRoutes,
        { path: ':pathMatch(.*)*', component: WorkspaceView },
      ],
    },
  ],
});
router.beforeEach(async (to) => {
  if (to.meta.public) return;
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
