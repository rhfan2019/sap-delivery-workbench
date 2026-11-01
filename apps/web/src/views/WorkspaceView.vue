<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppIcon from '../components/AppIcon.vue';
import BaseEmptyState from '../components/base/BaseEmptyState.vue';
import BaseTag from '../components/base/BaseTag.vue';
import BasePropertyRow from '../components/base/BasePropertyRow.vue';
import BaseSection from '../components/base/BaseSection.vue';
import BaseSkeleton from '../components/base/BaseSkeleton.vue';
import { menus, upcoming } from '../features/navigation';
import { HEALTH, PROJECT_STATUSES } from '@sap-delivery-workbench/contracts/projects/options';
import { api, ApiError, type Project } from '../services/session';
import { selectProject } from '../services/projectContext';
const route = useRoute();
const router = useRouter();
const projects = ref<Project[]>([]);
const project = ref<Project | null>(null);
const loading = ref(true);
const error = ref('');
const filter = ref('');
const isProjects = computed(() => route.path === '/projects');
const isDetail = computed(() => Boolean(route.params.id));
const module = computed(() => [...menus, ...upcoming].find((m) => m.path === route.path));
const filtered = computed(() =>
  projects.value.filter((p) =>
    (p.name + p.code + p.customerName).toLowerCase().includes(filter.value.toLowerCase()),
  ),
);
const status = (p: Project) =>
  p.isPaused ? '已暂停' : (PROJECT_STATUSES[p.status as 'active'] ?? p.status);
const tone = (p: Project) =>
  p.isPaused
    ? 'yellow'
    : (({ preparing: 'purple', active: 'blue', live: 'green', completed: 'neutral' } as const)[
        p.status as 'preparing'
      ] ?? 'neutral');
// One line of project facts a project manager scans: phase, go-live, health.
const facts = (p: Project) =>
  [
    p.customerName,
    p.currentPhase ? '当前阶段 ' + p.currentPhase : '',
    p.goLive ? '上线 ' + p.goLive : '',
  ]
    .filter(Boolean)
    .join(' · ');
const healthTone = { green: 'green', yellow: 'yellow', red: 'red' } as const;
async function openSettings(id: string) {
  await selectProject(id);
  await router.push('/project/general');
}
async function load() {
  loading.value = true;
  error.value = '';
  try {
    if (isDetail.value) project.value = await api<Project>('/projects/' + String(route.params.id));
    else if (isProjects.value) projects.value = await api<Project[]>('/projects');
  } catch (e) {
    error.value = (e as Error).message;
    if (e instanceof ApiError && e.status === 401) await router.replace('/login');
  } finally {
    loading.value = false;
  }
}
onMounted(load);
</script>
<template>
  <div v-if="isProjects" class="home">
    <header class="page-heading">
      <div>
        <h1>我的项目</h1>
        <p class="muted">你参与的项目，从需求到验收的交付都在项目中协作。</p>
      </div>
      <button class="secondary-button" :disabled="loading" @click="load">
        <AppIcon name="refresh" :size="16" />刷新
      </button>
    </header>
    <div class="projects-bar">
      <div class="filter-input">
        <AppIcon name="search" :size="16" /><input
          v-model="filter"
          aria-label="搜索项目"
          placeholder="搜索项目名称、客户或编号"
        />
      </div>
      <span class="projects-count">{{ filtered.length }} 个项目</span>
    </div>
    <div v-if="loading" class="home-skeleton">
      <BaseSkeleton v-for="n in 4" :key="n" />
    </div>
    <p v-else-if="error" class="error-note" role="alert">{{ error }}</p>
    <BaseEmptyState
      v-else-if="!filtered.length"
      :title="filter ? '没有匹配的项目' : '还没有加入项目'"
      :text="
        filter
          ? '换一个关键词再试试。'
          : '联系管理员建立客户、项目及成员关系，你参与的项目会显示在这里。'
      "
    >
      <template #icon><AppIcon name="folder" :size="16" /></template>
      <button v-if="filter" class="secondary-button" @click="filter = ''">清除搜索</button>
    </BaseEmptyState>
    <ul v-else class="project-list">
      <li v-for="p in filtered" :key="p.id">
        <RouterLink :to="'/projects/' + p.id" class="project-row">
          <span class="icon-tile"><AppIcon name="folder" :size="16" /></span>
          <span class="project-text">
            <strong>{{ p.name }}</strong>
            <small>{{ facts(p) }} · {{ p.code }}</small>
          </span>
          <BaseTag v-if="p.health" :tone="healthTone[p.health.overall as 'green']">{{
            HEALTH[p.health.overall as 'green']
          }}</BaseTag>
          <BaseTag :tone="tone(p)">{{ status(p) }}</BaseTag>
        </RouterLink>
      </li>
    </ul>
  </div>
  <div v-else-if="isDetail" class="home">
    <RouterLink to="/projects" class="text-link back-link"
      ><AppIcon name="back" :size="14" />我的项目</RouterLink
    >
    <div v-if="loading" class="home-skeleton"><BaseSkeleton v-for="n in 3" :key="n" /></div>
    <p v-else-if="error" class="error-note" role="alert">{{ error }}</p>
    <template v-else-if="project">
      <header class="page-heading">
        <div>
          <h1>{{ project.name }}</h1>
          <p class="muted">{{ project.customerName }}</p>
        </div>
        <div class="project-tags">
          <BaseTag variant="outline">{{ project.code }}</BaseTag>
          <BaseTag :tone="tone(project)">{{ status(project) }}</BaseTag>
          <button class="secondary-button" @click="openSettings(project.id)">项目设置</button>
        </div>
      </header>
      <section class="project-detail">
        <BaseSection title="项目概览">
          <p class="project-description">{{ project.description || '尚未填写项目说明。' }}</p>
          <dl>
            <BasePropertyRow label="所属客户">{{ project.customerName }}</BasePropertyRow>
            <BasePropertyRow label="当前阶段" :empty="!project.currentPhase">{{
              project.currentPhase
            }}</BasePropertyRow>
            <BasePropertyRow label="计划开始" :empty="!project.plannedStartDate">{{
              project.plannedStartDate?.slice(0, 10)
            }}</BasePropertyRow>
            <BasePropertyRow label="计划结束" :empty="!project.plannedEndDate">{{
              project.plannedEndDate?.slice(0, 10)
            }}</BasePropertyRow>
          </dl>
        </BaseSection>
      </section>
    </template>
  </div>
  <template v-else
    ><div class="page-heading">
      <div>
        <h1>{{ module?.label ?? '页面未找到' }}</h1>
        <p class="muted">{{ module?.description ?? '这个地址暂时没有对应的页面。' }}</p>
      </div>
      <BaseTag v-if="module">规划中</BaseTag>
    </div>
    <BaseEmptyState
      class="planned-page"
      :title="module ? '此模块尚未开放' : '页面未找到'"
      :text="
        module
          ? '它已纳入平台规划。现在可以使用工作台、开发清单与已授权的项目。'
          : '请通过左侧导航选择一个页面。'
      "
    >
      <template #icon><AppIcon :name="module?.icon ?? 'help'" :size="16" /></template>
      <RouterLink to="/home" class="secondary-button">返回工作台</RouterLink>
    </BaseEmptyState></template
  >
</template>
<style scoped>
.home {
  max-width: 1080px;
  margin: 0 auto;
}
.project-row:hover {
  background: var(--neutral-bg-2);
}
.project-text {
  display: grid;
  gap: var(--space-0-5);
  min-width: 0;
}
.project-text strong {
  font-size: var(--font-14);
  font-weight: var(--weight-550);
}
.project-text small {
  font-size: var(--font-12);
  line-height: var(--leading-16);
  color: var(--text-muted);
}
.project-list {
  margin: var(--space-3) 0 0;
  padding: 0;
  list-style: none;
  border-top: 1px solid var(--border);
}
.project-list li {
  border-bottom: 1px solid var(--border);
}
.project-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: var(--control-table-row);
  padding: var(--space-2) var(--space-2);
  transition: background var(--motion-fast);
}
.project-text {
  flex: 1;
}
.project-text strong,
.project-text small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.home-skeleton {
  display: grid;
  gap: var(--space-3);
  margin-top: var(--space-3);
}
.projects-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}
.projects-bar .filter-input {
  flex: 1;
  max-width: 420px;
}
.projects-bar .filter-input input {
  width: 100%;
}
.projects-count {
  font-size: var(--font-12);
  color: var(--text-muted);
}
.project-tags {
  display: flex;
  gap: var(--space-1-5);
}
.project-detail {
  max-width: 720px;
}
.project-description {
  margin-bottom: var(--space-3);
  color: var(--text-muted);
}
.project-detail dl {
  display: grid;
  gap: var(--space-1);
  margin: 0;
}
</style>
