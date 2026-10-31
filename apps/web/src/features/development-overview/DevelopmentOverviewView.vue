<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { AlertTriangle, CalendarClock, Lock, ListX, RefreshCw, LayoutGrid } from '@lucide/vue';
import type { OverviewFilter } from '@sap-delivery-workbench/contracts/delivery/overview';
import BaseBanner from '../../components/base/BaseBanner.vue';
import BaseEmptyState from '../../components/base/BaseEmptyState.vue';
import BaseIconButton from '../../components/base/BaseIconButton.vue';
import BaseSkeleton from '../../components/base/BaseSkeleton.vue';
import BaseTabs from '../../components/base/BaseTabs.vue';
import { api, ApiError } from '../../services/session';
import { currentProject } from '../../services/projectContext';
import MilestoneLine from './MilestoneLine.vue';
import ProjectView from './ProjectView.vue';
import TeamView from './TeamView.vue';
import { VIEWS, drillLink, type Overview, type ViewId } from './model';
import './overview.css';

// 开发管理 → 开发概览 (docs/specs/development-overview.md): one page, several views; the
// default view follows the user's role, permissions decide what each view shows.
const data = ref<Overview | null>(null);
const loading = ref(false);
const error = ref('');
const view = ref<ViewId>('project');
let chosen = false;
let generation = 0;
async function load() {
  const project = currentProject.value;
  const request = ++generation;
  error.value = '';
  if (!project) return;
  loading.value = true;
  try {
    const result = await api<Overview>('/projects/' + project + '/development-overview');
    if (request !== generation) return;
    data.value = result;
    // Views not built yet (phase 2) fall back to the project view.
    if (!chosen) view.value = VIEWS.find((v) => v.id === result.view && v.ready)?.id ?? 'project';
  } catch (e) {
    if (request !== generation) return;
    data.value = null;
    error.value =
      e instanceof ApiError && e.status === 403
        ? '你没有查看开发概览的权限，请联系项目经理。'
        : (e as Error).message;
  } finally {
    if (request === generation) loading.value = false;
  }
}
watch(
  currentProject,
  () => {
    data.value = null;
    chosen = false;
    void load();
  },
  { immediate: true },
);
const tabs = computed(() => VIEWS.map((v) => ({ id: v.id, label: v.label })));
const current = computed(() => VIEWS.find((v) => v.id === view.value)!);
function pick(id: string) {
  chosen = true;
  view.value = id as ViewId;
}

const router = useRouter();
function drill(filter: OverviewFilter, label: string) {
  if (!data.value) return;
  void router.push(drillLink(currentProject.value, filter, label, data.value.scope));
}

const cards = computed(() => {
  const d = data.value;
  if (!d) return [];
  const c = d.cards;
  const freeze = c.freeze;
  return [
    {
      id: 'risk',
      icon: AlertTriangle,
      label: '风险开发项',
      value: c.risk.count,
      tone: c.risk.count ? 'red' : '',
      sub: `已申报延误 ${c.risk.declared} · 逾期未更新 ${c.risk.stale}`,
      open: () => drill(c.risk.filter, '风险'),
    },
    {
      id: 'due',
      icon: CalendarClock,
      label: '两周内到期',
      value: c.dueSoon.count,
      tone: '',
      sub: '计划完成在今天起 14 天内、尚未完成',
      open: () => drill(c.dueSoon.filter, '两周内到期'),
    },
    {
      id: 'freeze',
      icon: Lock,
      label: '计划晚于开发冻结',
      value: freeze.count,
      tone: freeze.count ? 'red' : '',
      sub: freeze.date
        ? freeze.daysLeft! >= 0
          ? `距开发冻结 ${freeze.daysLeft} 天 · 开发阶段风险 ${freeze.risk}`
          : `开发冻结已过 ${-freeze.daysLeft!} 天 · 开发阶段风险 ${freeze.risk}`
        : '项目未设开发冻结日期',
      open: () => drill(freeze.filter, '开发计划晚于冻结'),
    },
    {
      id: 'gaps',
      icon: ListX,
      label: '计划缺口',
      value: c.gaps.count,
      tone: c.gaps.count ? 'yellow' : '',
      sub: `缺负责人 ${c.gaps.assignee} · 缺日期 ${c.gaps.dates} · 缺人天 ${c.gaps.effort}`,
      open: () => drill(c.gaps.filter, '计划缺口'),
    },
  ];
});
const done = computed(() => {
  const d = data.value;
  if (!d || !d.counts.items) return '';
  const pct = (n: number) => Math.round((n / d.counts.items) * 100) + '%';
  return `共 ${d.counts.items} 项 · 开发完成 ${d.counts.developmentDone}（${pct(d.counts.developmentDone)}）· 交付完成 ${d.counts.deliveryDone}（${pct(d.counts.deliveryDone)}）${d.counts.removed ? ` · 已移出范围 ${d.counts.removed}` : ''}`;
});
const scoped = computed(() => !!(data.value?.scope.owner || data.value?.scope.modules));
</script>
<template>
  <div class="ov">
    <h1 class="ov-sr">开发概览</h1>
    <div class="ov-head">
      <BaseTabs :model-value="view" :tabs="tabs" label="视角" @update:model-value="pick" />
      <span class="ov-head-right">
        <span v-if="data" class="ov-note">{{ done }}</span>
        <BaseIconButton label="刷新" size="sm" :disabled="loading" @click="load()"
          ><RefreshCw
        /></BaseIconButton>
      </span>
    </div>

    <BaseBanner v-if="error" tone="red">{{ error }}</BaseBanner>
    <div v-else-if="!data" class="ov-loading" aria-busy="true">
      <BaseSkeleton height="64px" />
      <div class="ov-stats">
        <BaseSkeleton v-for="n in 4" :key="n" height="104px" />
      </div>
      <BaseSkeleton height="240px" />
    </div>
    <template v-else>
      <BaseBanner v-if="scoped" tone="blue"
        >按你的分配范围统计：{{
          [data.scope.owner ? '仅本人负责的开发项' : '', data.scope.modules?.join('、') ?? '']
            .filter(Boolean)
            .join('，')
        }}。</BaseBanner
      >
      <BaseEmptyState
        v-if="!current.ready"
        title="此视角在二期开放"
        text="二期补齐阶段开始时间、定稿时间后开放“我的”、顾问与测试视角。现在可以使用项目与开发组视角。"
        ><template #icon><LayoutGrid /></template
      ></BaseEmptyState>
      <BaseEmptyState
        v-else-if="!data.counts.items"
        title="还没有开发项"
        text="在开发清单中登记开发项后，这里会按阶段、风险与里程碑汇总。"
        ><template #icon><LayoutGrid /></template
      ></BaseEmptyState>
      <template v-else>
        <MilestoneLine :milestones="data.milestones" :today="data.today" />
        <section class="ov-section" aria-label="关键数字">
          <div class="ov-stats">
            <button
              v-for="c in cards"
              :key="c.id"
              type="button"
              class="ov-card ov-stat"
              @click="c.open"
            >
              <span class="label"><component :is="c.icon" />{{ c.label }}</span>
              <span class="value" :class="c.tone">{{ c.value }}</span>
              <span class="sub">{{ c.sub }}</span>
            </button>
          </div>
        </section>
        <ProjectView v-if="view === 'project'" :data="data" :drill="drill" />
        <TeamView v-else :data="data" :drill="drill" />
      </template>
    </template>
  </div>
</template>
<style scoped>
.ov-head-right {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
.ov-loading {
  display: grid;
  gap: var(--space-5);
}
</style>
