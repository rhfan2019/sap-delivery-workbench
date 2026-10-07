<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppIcon from '../components/AppIcon.vue';
import { menus, groups } from '../features/navigation';
import { api, identity, ApiError, type Project } from '../services/session';
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
  p.isPaused
    ? '已暂停'
    : ({ preparing: '准备中', active: '进行中', completed: '已完成', archived: '已归档' }[
        p.status
      ] ?? p.status);
const date = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  month: 'long',
  day: 'numeric',
  weekday: 'long',
}).format(new Date());
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
  <template v-if="isHome">
    <div class="page-heading">
      <div>
        <p class="eyebrow">YOUR DELIVERY, CONNECTED</p>
        <h1>你好，{{ identity?.user.displayName }}<span class="greeting-dot">。</span></h1>
        <p class="muted">让想法落地，让每一步交付清晰可见。</p>
      </div>
      <span class="date-label">{{ date }}</span>
    </div>
    <section class="welcome-banner">
      <div>
        <span class="banner-label">SAP 智能交付工作台</span>
        <h2>从业务需求，走向可信交付。</h2>
        <p>连接 FS、TS、开发与测试，在一个空间协同推进。</p>
        <RouterLink to="/projects" class="banner-link"
          >进入我的项目<AppIcon name="arrow" :size="17"
        /></RouterLink>
      </div>
      <div class="banner-graphic" aria-hidden="true">
        <div class="graphic-ring"></div>
        <div class="graphic-ring inner"></div>
        <span class="graphic-core"><AppIcon name="layers" :size="40" /></span
        ><span class="graphic-label gl-one">FS</span><span class="graphic-label gl-two">TS</span
        ><span class="graphic-label gl-three">DEV</span
        ><span class="graphic-label gl-four">TEST</span><span class="graphic-spark">✦</span>
      </div>
    </section>
    <section class="quick-section">
      <div class="section-heading">
        <h2>交付工作流</h2>
        <span>从需求开始，让成果可追溯</span>
      </div>
      <div class="quick-grid">
        <RouterLink
          v-for="(item, index) in [
            menus.find((m) => m.id === 'development-items')!,
            menus.find((m) => m.id === 'development-overview')!,
            menus.find((m) => m.id === 'organization')!,
            menus.find((m) => m.id === 'templates')!,
          ]"
          :key="item.id"
          :to="item.path"
          class="quick-card"
          ><div class="quick-card-top">
            <span class="icon-tile"><AppIcon :name="item.icon" :size="22" /></span
            ><span class="step-number">0{{ index + 1 }}</span>
          </div>
          <h3>{{ item.label }}</h3>
          <p>
            {{
              [
                '维护台账，编写功能规格',
                '项目驾驶舱，后续开放',
                '统一维护客户与项目',
                '统一交付标准与文档',
              ][index]
            }}
          </p>
          <AppIcon name="external" class="quick-arrow" :size="17"
        /></RouterLink>
      </div>
    </section>
    <div class="dashboard-lower">
      <section class="surface project-surface">
        <div class="section-heading">
          <h2>
            我的项目 <span class="count-badge">{{ loading ? '—' : projects.length }}</span>
          </h2>
          <RouterLink to="/projects" class="text-link"
            >查看全部<AppIcon name="arrow" :size="15"
          /></RouterLink>
        </div>
        <p v-if="loading" class="loading-state">正在读取项目…</p>
        <div v-else-if="error" class="error-note" role="alert">
          {{ error }}<button class="text-button" @click="load">重新加载</button>
        </div>
        <div v-else-if="!projects.length" class="empty-projects">
          <div class="empty-illustration"><AppIcon name="folder" :size="34" /><span>+</span></div>
          <h3>你的下一个项目，从这里开始</h3>
          <p>当前尚未分配项目。联系管理员加入项目后，<br />即可在这里查看项目与交付进展。</p>
          <RouterLink to="/projects" class="secondary-button"
            >了解项目空间<AppIcon name="arrow" :size="15"
          /></RouterLink>
        </div>
        <RouterLink
          v-for="p in projects.slice(0, 3)"
          v-else
          :key="p.id"
          :to="'/projects/' + p.id"
          class="project-row"
          ><span class="icon-tile"><AppIcon name="folder" /></span>
          <div>
            <h3>{{ p.name }}</h3>
            <p>{{ p.customerName }} · {{ p.code }}</p>
          </div>
          <span class="status-badge">{{ status(p) }}</span
          ><AppIcon name="arrow" :size="16"
        /></RouterLink>
      </section>
      <section class="surface resources-surface">
        <div class="section-heading">
          <h2>团队知识与资产</h2>
          <AppIcon name="library" :size="18" />
        </div>
        <p class="resource-intro">让经验沉淀，让专业持续复用。</p>
        <RouterLink
          v-for="id in ['qa', 'assets', 'templates']"
          :key="id"
          :to="menus.find((m) => m.id === id)!.path"
          class="resource-link"
          ><span class="icon-tile"><AppIcon :name="menus.find((m) => m.id === id)!.icon" /></span>
          <div>
            <h3>{{ menus.find((m) => m.id === id)!.label }}</h3>
            <p>
              {{
                id === 'qa'
                  ? '带着问题，寻找有据可循的答案'
                  : id === 'assets'
                    ? '复用成熟代码，积累交付能力'
                    : '统一交付标准，减少重复工作'
              }}
            </p>
          </div>
          <AppIcon name="external" :size="16"
        /></RouterLink>
        <p class="resource-note"><AppIcon name="sparkles" :size="14" /> 知识与资产能力正在建设中</p>
      </section>
    </div>
  </template>
  <template v-else-if="isProjects"
    ><div class="page-heading">
      <div>
        <p class="eyebrow">PROJECT SPACE</p>
        <h1>我的项目</h1>
        <p class="muted">在项目中组织协作，贯通从需求到验收的完整交付。</p>
      </div>
      <button class="secondary-button" @click="load" :disabled="loading">
        <AppIcon name="refresh" :size="16" />刷新
      </button>
    </div>
    <section class="surface projects-list">
      <div class="section-heading">
        <h2>
          参与的项目 <span class="count-badge">{{ projects.length }}</span>
        </h2>
        <div class="filter-input">
          <AppIcon name="search" :size="17" /><input
            v-model="filter"
            aria-label="搜索项目"
            placeholder="搜索项目名称、客户或编号"
          />
        </div>
      </div>
      <p v-if="loading" class="loading-state">正在加载项目…</p>
      <p v-else-if="error" class="error-note" role="alert">{{ error }}</p>
      <div v-else-if="!filtered.length" class="empty-projects large">
        <div class="empty-illustration"><AppIcon name="folder" :size="38" /><span>+</span></div>
        <h2>{{ filter ? '未找到匹配项目' : '尚未加入项目' }}</h2>
        <p>
          {{
            filter
              ? '请换一个关键词再试试。'
              : '联系管理员建立客户、项目及成员关系。你获准参与的项目将显示在这里。'
          }}
        </p>
        <button v-if="filter" class="secondary-button" @click="filter = ''">清除搜索</button
        ><RouterLink v-else to="/home" class="secondary-button"
          >返回工作台<AppIcon name="arrow" :size="16"
        /></RouterLink>
      </div>
      <RouterLink
        v-for="p in filtered"
        v-else
        :key="p.id"
        :to="'/projects/' + p.id"
        class="project-row"
        ><span class="icon-tile"><AppIcon name="folder" /></span>
        <div>
          <h3>{{ p.name }}</h3>
          <p>{{ p.customerName }} · {{ p.code }}</p>
        </div>
        <span class="status-badge">{{ status(p) }}</span
        ><AppIcon name="arrow"
      /></RouterLink></section
  ></template>
  <template v-else-if="isDetail"
    ><RouterLink to="/projects" class="text-link back-link"
      ><AppIcon name="back" :size="17" />返回我的项目</RouterLink
    >
    <p v-if="loading" class="loading-state">正在读取项目…</p>
    <p v-else-if="error" class="error-note" role="alert">{{ error }}</p>
    <template v-else-if="project"
      ><div class="page-heading">
        <div>
          <p class="eyebrow">{{ project.code }}</p>
          <h1>{{ project.name }}</h1>
          <p class="muted">{{ project.customerName }}</p>
        </div>
        <span class="status-badge">{{ status(project) }}</span>
      </div>
      <section class="surface project-detail">
        <h2>项目概览</h2>
        <p>{{ project.description || '尚未填写项目说明。' }}</p>
        <dl>
          <div>
            <dt>所属客户</dt>
            <dd>{{ project.customerName }}</dd>
          </div>
          <div>
            <dt>计划开始</dt>
            <dd>{{ project.plannedStartDate?.slice(0, 10) || '未设置' }}</dd>
          </div>
          <div>
            <dt>计划结束</dt>
            <dd>{{ project.plannedEndDate?.slice(0, 10) || '未设置' }}</dd>
          </div>
        </dl>
        <p class="help-note">交付项、文档、开发与测试能力将逐步接入此项目空间。</p>
      </section></template
    ></template
  >
  <template v-else
    ><div class="page-heading">
      <div>
        <p class="eyebrow">
          {{
            groups.find((g) => g.items.some((i) => i.id === module?.id))?.id === 'admin'
              ? 'ADMINISTRATION'
              : 'DELIVERY WORKSPACE'
          }}
        </p>
        <h1>{{ module?.label ?? '页面未找到' }}</h1>
        <p class="muted">{{ module?.description ?? '这个地址暂时没有对应的页面。' }}</p>
      </div>
      <span v-if="module" class="status-badge planned">规划中</span>
    </div>
    <section class="surface planned-page">
      <div class="planned-art">
        <span class="planned-orbit"></span
        ><span class="planned-icon"><AppIcon :name="module?.icon ?? 'help'" :size="38" /></span
        ><span class="planned-star">✦</span>
      </div>
      <p class="eyebrow">{{ module ? 'BUILDING THE NEXT STEP' : 'PAGE NOT FOUND' }}</p>
      <h2>{{ module ? '为下一步交付，做好准备' : '返回熟悉的工作空间' }}</h2>
      <p>
        {{ module ? '此模块已纳入平台规划，业务功能尚未开放。' : '请通过左侧导航选择一个有效页面。'
        }}<br v-if="module" /><template v-if="module"
          >当前可使用账号登录、工作台与已授权项目查询。</template
        >
      </p>
      <RouterLink to="/home" class="primary-button"
        >返回工作台<AppIcon name="arrow" :size="17"
      /></RouterLink>
      <div v-if="module" class="planned-footer">
        <AppIcon name="layers" :size="16" /><span>项目交付 · 公共资产 · 企业管理</span>
      </div>
    </section></template
  >
</template>
