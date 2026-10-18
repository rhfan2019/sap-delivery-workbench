<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppIcon from '../components/AppIcon.vue';
import BaseEmptyState from '../components/base/BaseEmptyState.vue';
import BaseTag from '../components/base/BaseTag.vue';
import BasePropertyRow from '../components/base/BasePropertyRow.vue';
import BaseSection from '../components/base/BaseSection.vue';
import BaseSkeleton from '../components/base/BaseSkeleton.vue';
import { menus } from '../features/navigation';
import { HEALTH, PROJECT_STATUSES } from '@sap-delivery-workbench/contracts/projects/options';
import { api, identity, ApiError, type Project } from '../services/session';
import { selectProject } from '../services/projectContext';
const route = useRoute();
const router = useRouter();
const projects = ref<Project[]>([]);
const project = ref<Project | null>(null);
const loading = ref(true);
const error = ref('');
const filter = ref('');
const isHome = computed(() => route.path === '/home');
const isProjects = computed(() => route.path === '/projects');
const isDetail = computed(() => Boolean(route.params.id));
const module = computed(() => menus.find((m) => m.path === route.path));
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
const pick = (ids: string[]) => ids.map((id) => menus.find((m) => m.id === id)!).filter(Boolean);
// The home page (DESIGN.md 6.4): what people open most, then their projects and knowledge.
const shortcuts = pick(['development-items', 'project-plan', 'sap-credentials', 'templates']);
const knowledge = pick(['qa', 'knowledge', 'assets']);
const date = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  month: 'long',
  day: 'numeric',
  weekday: 'long',
}).format(new Date());
async function openSettings(id: string) {
  await selectProject(id);
  await router.push('/settings/project/general');
}
async function load() {
  loading.value = true;
  error.value = '';
  try {
    if (isDetail.value) project.value = await api<Project>('/projects/' + String(route.params.id));
    else if (isHome.value || isProjects.value) projects.value = await api<Project[]>('/projects');
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
  <div v-if="isHome" class="home">
    <header class="page-heading">
      <div>
        <h1>你好，{{ identity?.user.displayName }}</h1>
        <p class="muted">{{ date }} · 从开发清单开始今天的交付。</p>
      </div>
      <RouterLink to="/workspace/development-items" class="primary-button"
        ><AppIcon name="file" :size="16" />打开开发清单</RouterLink
      >
    </header>
    <section class="home-group" aria-labelledby="home-start">
      <h2 id="home-start">常用</h2>
      <div class="home-cards">
        <RouterLink v-for="item in shortcuts" :key="item.id" :to="item.path" class="home-card">
          <span class="icon-tile"><AppIcon :name="item.icon" :size="16" /></span>
          <span class="home-card-text">
            <strong>{{ item.label }}</strong>
            <small>{{ item.description }}</small>
          </span>
        </RouterLink>
      </div>
    </section>
    <div class="home-columns">
      <section class="home-group" aria-labelledby="home-projects">
        <div class="home-group-head">
          <h2 id="home-projects">
            我的项目<span class="count-badge">{{ loading ? '—' : projects.length }}</span>
          </h2>
          <RouterLink to="/projects" class="text-link">查看全部</RouterLink>
        </div>
        <div v-if="loading" class="home-skeleton">
          <BaseSkeleton v-for="n in 3" :key="n" />
        </div>
        <p v-else-if="error" class="error-note" role="alert">
          {{ error }}<button class="text-button" @click="load">重新加载</button>
        </p>
        <BaseEmptyState
          v-else-if="!projects.length"
          title="还没有加入项目"
          text="联系管理员把你加入项目后，项目会显示在这里。"
        >
          <template #icon><AppIcon name="folder" :size="16" /></template>
        </BaseEmptyState>
        <ul v-else class="project-list">
          <li v-for="p in projects.slice(0, 5)" :key="p.id">
            <RouterLink :to="'/projects/' + p.id" class="project-row">
              <span class="icon-tile"><AppIcon name="folder" :size="16" /></span>
              <span class="project-text">
                <strong>{{ p.name }}</strong>
                <small>{{ facts(p) }}</small>
              </span>
              <BaseTag v-if="p.health" :tone="healthTone[p.health.overall as 'green']">{{
                HEALTH[p.health.overall as 'green']
              }}</BaseTag>
              <BaseTag :tone="tone(p)">{{ status(p) }}</BaseTag>
            </RouterLink>
          </li>
        </ul>
      </section>
      <section class="home-group" aria-labelledby="home-knowledge">
        <div class="home-group-head">
          <h2 id="home-knowledge">知识与资产</h2>
          <BaseTag>建设中</BaseTag>
        </div>
        <ul class="project-list">
          <li v-for="item in knowledge" :key="item.id">
            <RouterLink :to="item.path" class="project-row">
              <span class="icon-tile"><AppIcon :name="item.icon" :size="16" /></span>
              <span class="project-text">
                <strong>{{ item.label }}</strong>
                <small>{{ item.description }}</small>
              </span>
            </RouterLink>
          </li>
        </ul>
      </section>
    </div>
  </div>
  <div v-else-if="isProjects" class="home">
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
.home-group {
  margin-top: var(--space-6);
}
.home-group > h2,
.home-group-head h2 {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--font-14);
  font-weight: var(--weight-550);
}
.home-group-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}
.home-cards {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--space-3);
  margin-top: var(--space-3);
}
.home-card {
  display: grid;
  gap: var(--space-3);
  padding: var(--space-4);
  border: 1px solid var(--border);
  border-radius: var(--radius-8);
  background: var(--panel);
  box-shadow: var(--shadow-card);
  transition:
    background var(--motion-fast),
    border-color var(--motion-fast);
}
.home-card:hover,
.project-row:hover {
  background: var(--neutral-bg-2);
}
.home-card:hover {
  border-color: var(--border-strong);
}
.home-card-text,
.project-text {
  display: grid;
  gap: var(--space-0-5);
  min-width: 0;
}
.home-card strong,
.project-text strong {
  font-size: var(--font-14);
  font-weight: var(--weight-550);
}
.home-card small,
.project-text small {
  font-size: var(--font-12);
  line-height: var(--leading-16);
  color: var(--text-muted);
}
.home-columns {
  display: grid;
  grid-template-columns: 3fr 2fr;
  gap: var(--space-6);
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
@media (max-width: 950px) {
  .home-cards {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .home-columns {
    grid-template-columns: 1fr;
    gap: 0;
  }
}
</style>
