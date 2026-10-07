import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { ApiError, identity } from '../../services/session';
import { adminApi } from './api';
import type { Organization, Customer, AdminProject } from './types';

export function useAdminData() {
  const router = useRouter();
  const organization = ref<Organization | null>(null),
    customers = ref<Customer[]>([]),
    projects = ref<AdminProject[]>([]),
    loading = ref(false),
    error = ref('');
  async function load() {
    if (!identity.value?.canManageOrganization) {
      error.value = '此功能仅限企业管理员使用。';
      return;
    }
    loading.value = true;
    error.value = '';
    try {
      const [o, c, p] = await Promise.all([
        adminApi.organization(),
        adminApi.customers(),
        adminApi.projects(),
      ]);
      organization.value = o;
      customers.value = c;
      projects.value = p;
    } catch (e) {
      error.value = (e as Error).message;
      if (e instanceof ApiError && e.status === 401) await router.replace('/login');
    } finally {
      loading.value = false;
    }
  }
  return { organization, customers, projects, loading, error, load };
}
