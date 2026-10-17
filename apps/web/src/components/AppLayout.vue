<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppIcon from './AppIcon.vue';
import ConfirmDialog from './ConfirmDialog.vue';
import UserMenu from './UserMenu.vue';
import { groups, menus } from '../features/navigation';
import { api, identity } from '../services/session';
import { syncAppearance } from '../services/theme';
import {
  projects,
  currentProject as selected,
  defaultProject,
  projectError,
  loadProjects,
  selectProject,
  setDefaultProject,
  leaveDelivery,
} from '../services/projectContext';
const route = useRoute();
const router = useRouter();
function preference(key: string, fallback: string) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
const collapsed = ref(preference('sidebar', 'wide') === 'narrow');
const mobile = ref(false);
const search = ref('');
const expanded = ref<Record<string, boolean>>({ delivery: true, knowledge: false, admin: false });
const logoutError = ref('');
const loggingOut = ref(false);
const current = computed(
  () =>
    menus.find((m) => route.path === m.path)?.label ??
    (/\/development-items\/[^/]+\/design$/.test(route.path)
      ? '设计助手'
      : /\/development-items\/[^/]+\/development$/.test(route.path)
        ? '开发助手'
        : route.path.startsWith('/projects/')
          ? '项目概览'
          : route.path === '/settings'
            ? '个人设置'
            : '页面导航'),
);
const results = computed(() =>
  menus.filter((m) => m.label.toLowerCase().includes(search.value.trim().toLowerCase())),
);
watch(collapsed, () => {
  try {
    localStorage.setItem('sidebar', collapsed.value ? 'narrow' : 'wide');
  } catch {
    /* preferences are optional */
  }
});
watch(
  () => route.path,
  () => {
    mobile.value = false;
    search.value = '';
    for (const group of groups) {
      if (group.items.some((i) => i.path === route.path)) expanded.value[group.id] = true;
    }
  },
  { immediate: true },
);
watch(
  () => route.path,
  async () => {
    await loadProjects();
  },
  { immediate: true },
);
function toggleGroup(id: string) {
  if (collapsed.value) {
    collapsed.value = false;
    expanded.value[id] = true;
  } else expanded.value[id] = !expanded.value[id];
}
async function logout() {
  if (leaveDelivery.value && !(await leaveDelivery.value())) return;
  loggingOut.value = true;
  logoutError.value = '';
  try {
    await api('/logout', {});
    identity.value = null;
    await router.replace('/login');
  } catch (e) {
    logoutError.value = (e as Error).message;
  } finally {
    loggingOut.value = false;
  }
}
// The account's theme and mode (个人设置 › 外观) replace this browser's cached choice.
onMounted(() => void syncAppearance());
</script>
<template>
  <ConfirmDialog />
  <div class="app-shell" :class="{ collapsed, 'mobile-open': mobile }">
    <a class="skip-link" href="#main-content">跳转到主要内容</a
    ><button v-if="mobile" class="nav-scrim" aria-label="关闭导航" @click="mobile = false"></button>
    <aside class="sidebar" aria-label="主导航">
      <div class="sidebar-brand">
        <RouterLink to="/home" class="brand"
          ><span class="brand-mark">S<span>↗</span></span
          ><span class="wide-only"
            >SAP 智能交付<span class="brand-sub">DELIVERY WORKBENCH</span
            ><span class="brand-organization" :title="identity?.organization.name">{{
              identity?.organization.name
            }}</span></span
          ></RouterLink
        ><button
          class="icon-button collapse-toggle"
          :aria-label="collapsed ? '展开侧栏' : '收起侧栏'"
          @click="collapsed = !collapsed"
        >
          <AppIcon :name="collapsed ? 'expand' : 'collapse'" /></button
        ><button class="icon-button mobile-close" aria-label="关闭导航" @click="mobile = false">
          <AppIcon name="x" />
        </button>
      </div>
      <div class="sidebar-user">
        <span class="avatar">{{ identity?.user.displayName.slice(0, 1) }}</span>
        <div class="wide-only">
          <small>你好，欢迎回来</small><strong>{{ identity?.user.displayName }}</strong>
        </div>
        <span class="online-dot wide-only" title="已登录"></span>
      </div>
      <div class="nav-search" v-if="!collapsed">
        <AppIcon name="search" :size="17" /><input
          v-model="search"
          aria-label="搜索菜单"
          placeholder="搜索菜单…"
        /><span v-if="!search" class="search-hint">⌕</span
        ><button v-else class="icon-button" aria-label="清除搜索" @click="search = ''">
          <AppIcon name="x" :size="14" />
        </button>
      </div>
      <button
        v-else
        class="nav-search icon-search"
        aria-label="搜索菜单"
        @click="collapsed = false"
      >
        <AppIcon name="search" />
      </button>
      <nav class="nav-scroll">
        <template v-if="search.trim()"
          ><p class="nav-caption">搜索结果 · {{ results.length }}</p>
          <RouterLink
            v-for="item in results"
            :key="item.id"
            :to="item.path"
            class="nav-item"
            :class="{ active: route.path === item.path }"
            ><AppIcon :name="item.icon" /><span>{{ item.label }}</span></RouterLink
          >
          <p v-if="!results.length" class="search-empty">
            未找到匹配菜单，试试“项目”或“测试”。
          </p></template
        ><template v-else>
          <RouterLink
            to="/home"
            class="nav-item home-link"
            :class="{ active: route.path === '/home' }"
            title="工作台"
            ><AppIcon name="grid" /><span class="wide-only">工作台</span
            ><span class="nav-dot wide-only" v-if="route.path === '/home'"></span
          ></RouterLink>
          <p class="nav-caption wide-only">工作空间</p>
          <section v-for="group in groups" :key="group.id" class="nav-group">
            <button
              class="nav-item group-button"
              :class="{ 'group-active': group.items.some((i) => i.path === route.path) }"
              :title="group.label"
              :aria-expanded="!collapsed && expanded[group.id]"
              @click="toggleGroup(group.id)"
            >
              <AppIcon :name="group.icon" /><span class="wide-only">{{ group.label }}</span
              ><AppIcon
                class="group-chevron wide-only"
                :class="{ rotated: expanded[group.id] }"
                name="chevron"
                :size="15"
              />
            </button>
            <div v-if="!collapsed && expanded[group.id]" class="subnav">
              <RouterLink
                v-for="item in group.items"
                :key="item.id"
                :to="item.path"
                class="subnav-item"
                :class="{ active: route.path === item.path }"
                ><span>{{ item.label }}</span
                ><span v-if="route.path === item.path" class="subnav-dot"></span
              ></RouterLink>
            </div>
          </section>
        </template>
      </nav>
    </aside>
    <div class="main-shell">
      <header class="topbar">
        <div class="breadcrumb">
          <button
            class="icon-button mobile-menu"
            aria-label="打开导航"
            @click="
              mobile = true;
              collapsed = false;
            "
          >
            <AppIcon name="menu" /></button
          ><AppIcon name="building" :size="17" /><span class="organization-name">{{
            identity?.organization.name
          }}</span
          ><span class="breadcrumb-slash">/</span><strong>{{ current }}</strong>
        </div>
        <div class="topbar-right">
          <label class="project-selector"
            ><AppIcon name="folder" :size="16" /><select
              :value="selected"
              aria-label="切换项目"
              @change="
                async (event: Event) => {
                  const control = event.target as HTMLSelectElement;
                  await selectProject(control.value);
                  control.value = selected;
                }
              "
            >
              <option value="">{{ projects.length ? '选择项目' : '暂无参与项目' }}</option>
              <option v-for="project in projects" :key="project.id" :value="project.id">
                {{ project.name }}
              </option>
            </select></label
          ><button
            class="text-button"
            :disabled="!selected || selected === defaultProject"
            @click="setDefaultProject"
          >
            {{ selected && selected === defaultProject ? '默认项目' : '设为默认' }}</button
          ><span v-if="projectError" class="error-note" role="alert">{{ projectError }}</span
          ><span class="topbar-divider"></span><UserMenu :busy="loggingOut" @logout="logout" />
        </div>
      </header>
      <p v-if="logoutError" class="error-note" role="alert">{{ logoutError }}</p>
      <main id="main-content" class="main-content">
        <RouterView :key="route.meta.keepOnQuery ? route.path : route.fullPath" />
      </main>
    </div>
  </div>
</template>
