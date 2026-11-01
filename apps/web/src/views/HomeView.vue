<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CalendarClock,
  CheckCircle2,
  Flag,
  Grid3x3,
  Lock,
  MessageSquare,
  Sparkles,
  TrendingDown,
  Users,
} from '@lucide/vue';
import { PHASES as ITEM_PHASES } from '@sap-delivery-workbench/contracts/delivery/fields';
import { daysBetween, addDays } from '@sap-delivery-workbench/contracts/delivery/overview';
import {
  HEALTH as HEALTH_LABELS,
  PHASES as PROJECT_PHASES,
  milestoneState,
} from '@sap-delivery-workbench/contracts/projects/options';
import AppIcon from '../components/AppIcon.vue';
import BaseEmptyState from '../components/base/BaseEmptyState.vue';
import BaseSkeleton from '../components/base/BaseSkeleton.vue';
import BaseTag from '../components/base/BaseTag.vue';
import DashArea from '../components/dashboard/DashArea.vue';
import DashCard from '../components/dashboard/DashCard.vue';
import DashMetric, { type Trend } from '../components/dashboard/DashMetric.vue';
import {
  assistantLink,
  drillLink,
  itemLink,
  openFrom,
  pct,
  shortDate,
  type Overview,
} from '../features/development-overview/model';
import { menus } from '../features/navigation';
import { api, ApiError, identity } from '../services/session';
import { currentProject, projectAccess, projects } from '../services/projectContext';

// 工作台 (docs/roadmap.md 2 and 6.6, docs/DESIGN.md 12): the first screen and the cover for a
// demo. Three layers, top to bottom: the project layer for those who run the project (phase,
// key numbers, this week, trend, milestones, modules, team), then the personal layer for anyone
// with work of their own. Personal work goes first when something is overdue. Every number comes
// from the development overview and opens the list it counts.
const router = useRouter();
const data = ref<Overview | null>(null);
const loading = ref(false);
const error = ref('');
let generation = 0;
const may = (code: string) => !!projectAccess.value?.permissions.includes(code);
async function load() {
  const id = currentProject.value;
  const request = ++generation;
  data.value = null;
  error.value = '';
  if (!id || !may('delivery.overview:view')) return;
  loading.value = true;
  try {
    const result = await api<Overview>('/projects/' + id + '/development-overview');
    if (request === generation) data.value = result;
  } catch (e) {
    if (request !== generation) return;
    error.value = e instanceof ApiError && e.status === 403 ? '' : (e as Error).message;
  } finally {
    if (request === generation) loading.value = false;
  }
}
watch([currentProject, projectAccess], () => void load(), { immediate: true });

const project = computed(() => projects.value.find((p) => p.id === currentProject.value) ?? null);
const today = computed(() => data.value?.today ?? new Date().toISOString().slice(0, 10));
const hour = Number(
  new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: 'numeric', hour12: false })
    .format(new Date())
    .replace(/\D/g, ''),
);
const greeting = hour < 12 ? '上午好' : hour < 18 ? '下午好' : '晚上好';
const date = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  month: 'long',
  day: 'numeric',
  weekday: 'long',
}).format(new Date());

// Layers (roadmap 6.6): decided by permissions and the data, never by role codes.
const projectLayer = computed(
  () =>
    !!data.value &&
    (may('project.plan:edit') ||
      may('project.member:manage') ||
      data.value.view === 'project' ||
      data.value.view === 'team'),
);
const todo = computed(() => data.value?.mine.today ?? []);
const respond = computed(() => data.value?.mine.respond ?? []);
const personalLayer = computed(() => todo.value.length > 0 || respond.value.length > 0);
const overdue = computed(() =>
  todo.value.some((t) => t.plannedEnd !== null && t.plannedEnd <= today.value),
);
const personalFirst = computed(() => personalLayer.value && (!projectLayer.value || overdue.value));

function drill(filter: Parameters<typeof drillLink>[1], label: string) {
  if (!data.value) return;
  void openFrom(router, drillLink(currentProject.value, filter, label, data.value.scope));
}
const open = (path: string) => void openFrom(router, path);

// The hero: the Activate phase, the days to go-live and the phase steps.
const phase = computed(() => {
  const name = project.value?.currentPhase ?? null;
  const index = PROJECT_PHASES.findIndex((p) => p.name === name);
  const goLive = project.value?.goLive ?? null;
  return {
    name: name ?? '未设阶段',
    index,
    steps: PROJECT_PHASES.map((p, i) => ({
      name: p.name,
      state: index < 0 ? '' : i < index ? 'done' : i === index ? 'now' : '',
    })),
    goLiveDays: goLive ? daysBetween(today.value, goLive) : null,
    goLive,
  };
});
const health = computed(() => project.value?.health ?? null);

// Four key numbers with their trend (roadmap 2.3).
const metrics = computed(() => {
  const d = data.value;
  if (!d) return [];
  const items = d.counts.items;
  const weeks = d.flow.pace.lastWeeks;
  const thisWeek = weeks[weeks.length - 1] ?? 0;
  const lastWeek = weeks[weeks.length - 2] ?? 0;
  const paceTrend: Trend | null =
    weeks.length > 1
      ? {
          text: (thisWeek >= lastWeek ? '+' : '') + Math.round((thisWeek - lastWeek) * 10) / 10,
          direction: thisWeek > lastWeek ? 'up' : thisWeek < lastWeek ? 'down' : 'flat',
          good: thisWeek === lastWeek ? null : thisWeek > lastWeek,
        }
      : null;
  const freeze = d.cards.freeze;
  return [
    {
      id: 'done',
      icon: CheckCircle2,
      label: '开发完成率',
      value: pct(d.counts.developmentDone, items),
      unit: '%',
      tone: '' as const,
      trend: null,
      sub: `${d.counts.developmentDone} / ${items} 项开发完成`,
      open: () => drill({ phase: 'development', status: 'completed' }, '开发已完成'),
    },
    {
      id: 'risk',
      icon: AlertTriangle,
      label: '风险开发项',
      value: d.cards.risk.count,
      unit: '项',
      tone: d.cards.risk.count ? ('red' as const) : ('' as const),
      trend: null,
      sub: `已申报延误 ${d.cards.risk.declared} · 逾期未更新 ${d.cards.risk.stale}`,
      open: () => drill(d.cards.risk.filter, '风险'),
    },
    {
      id: 'freeze',
      icon: Lock,
      label: '开发冻结',
      value: freeze.date ? Math.abs(freeze.daysLeft ?? 0) : '—',
      unit: freeze.date ? (freeze.daysLeft! >= 0 ? '天后' : '天前') : '',
      tone: freeze.count ? ('yellow' as const) : ('' as const),
      trend: null,
      sub: freeze.date
        ? `${shortDate(freeze.date)} · 计划晚于冻结 ${freeze.count} 项`
        : '项目未设开发冻结日期',
      open: () => drill(freeze.filter, '开发计划晚于冻结'),
    },
    {
      id: 'pace',
      icon: BarChart3,
      label: '本周完成人天',
      value: Math.round(thisWeek * 10) / 10,
      unit: '人天',
      tone: '' as const,
      trend: paceTrend,
      sub:
        d.flow.pace.requiredPerWeek !== null
          ? `冻结前需每周 ${d.flow.pace.requiredPerWeek} · 近 4 周均 ${d.flow.pace.recentPerWeek}`
          : `近 4 周平均每周 ${d.flow.pace.recentPerWeek}`,
      open: undefined,
    },
  ];
});

// This week in a few lines: the computed project signal, the pace against the freeze and what is
// due next week. Rules, not a model: an AI-written summary is backlog FEAT-019.
const points = computed(() => {
  const d = data.value;
  if (!d) return [];
  const list: { tone: 'red' | 'yellow' | 'blue'; text: string }[] = d.signal.reasons
    .slice(0, 3)
    .map((r) => ({ tone: r.level, text: r.text }));
  const p = d.flow.pace;
  if (p.requiredPerWeek !== null && p.recentPerWeek < p.requiredPerWeek)
    list.push({
      tone: 'yellow',
      text: `近 4 周每周完成 ${p.recentPerWeek} 人天，低于冻结前所需的 ${p.requiredPerWeek}。`,
    });
  if (d.week.due.length)
    list.push({ tone: 'blue', text: `下周有 ${d.week.due.length} 个阶段到期。` });
  if (d.week.completed.length)
    list.push({ tone: 'blue', text: `本周完成 ${d.week.completed.length} 个阶段。` });
  return list.slice(0, 4);
});
const signal = computed(() => data.value?.signal.color ?? 'green');

// The burn-down of the open FSD and development effort with the ideal line to the freeze.
const trend = computed(() => {
  const f = data.value?.flow;
  if (!f || f.days.length < 2) return null;
  const ideal = f.ideal;
  const target = ideal
    ? f.days.map((day) => {
        const span = daysBetween(ideal.from.date, ideal.to.date) || 1;
        const at = daysBetween(ideal.from.date, day);
        return Math.max(0, ideal.from.value * (1 - at / span));
      })
    : undefined;
  return { values: f.remaining, labels: f.days.map(shortDate), target };
});

// The next milestones, nearest first.
const milestones = computed(() => {
  const d = data.value;
  if (!d) return [];
  return d.milestones
    .filter((m) => m.plannedOn && !m.achievedOn)
    .sort((a, b) => a.plannedOn!.localeCompare(b.plannedOn!))
    .slice(0, 4)
    .map((m) => {
      const days = daysBetween(today.value, m.plannedOn!);
      const state = milestoneState(m, today.value);
      return {
        key: m.key,
        name: m.name,
        date: shortDate(m.plannedOn!),
        when: days === 0 ? '今天' : days > 0 ? `${days} 天后` : `已过 ${-days} 天`,
        tone: state === 'delayed' ? 'red' : state === 'due' ? 'yellow' : 'neutral',
      } as const;
    });
});

// Modules × phases: share completed, outlined when something is at risk.
const heatPhases = ITEM_PHASES.map((p) => ({ key: p.key, label: p.label }));
const heat = computed(() => {
  const d = data.value;
  if (!d) return [];
  return Object.entries(d.moduleMatrix)
    .map(([module, row]) => ({
      module,
      cells: heatPhases.map((p) => {
        const c = row[p.key] ?? { total: 0, completed: 0, risk: 0 };
        const share = c.total ? c.completed / c.total : 0;
        return {
          key: p.key,
          label: p.label,
          total: c.total,
          text: c.total ? pct(c.completed, c.total) + '%' : '—',
          level: c.total ? 'h' + Math.min(4, Math.ceil(share * 4)) : '',
          risk: c.risk > 0,
          hint: `${module} · ${p.label}：完成 ${c.completed} / ${c.total}${c.risk ? `，风险 ${c.risk}` : ''}`,
        };
      }),
    }))
    .filter((r) => r.cells.some((c) => c.total));
});

// This week's planned development effort per person, over five days marked.
const team = computed(() => {
  const d = data.value;
  if (!d || !d.team || !d.load.rows.length) return [];
  const max = Math.max(5, ...d.load.rows.map((r) => r.days[0] ?? 0));
  return d.load.rows
    .filter((r) => r.userId)
    .map((r) => ({
      name: r.name,
      days: Math.round((r.days[0] ?? 0) * 10) / 10,
      width: Math.round(((r.days[0] ?? 0) / max) * 100),
      over: (r.days[0] ?? 0) > 5,
    }))
    .sort((a, b) => b.days - a.days)
    .slice(0, 6);
});

// Personal work (roadmap 6.6 personal layer).
const stageLabel = (key: string) => ITEM_PHASES.find((p) => p.key === key)?.label ?? key;
function openTodo(t: Overview['mine']['today'][number]) {
  open(
    t.stage
      ? assistantLink(currentProject.value, t.id, t.stage)
      : itemLink(currentProject.value, t.id),
  );
}

// Entry points for those without the overview, and the coming-soon announcements (roadmap 3.1).
const pick = (ids: string[]) => ids.map((id) => menus.find((m) => m.id === id)!).filter(Boolean);
const shortcuts = pick(['development-items', 'development-overview', 'development-load']);
const coming = pick(['qa', 'knowledge', 'assets', 'templates']);
const hasProject = computed(() => !!currentProject.value);
const weekEnd = computed(() => shortDate(addDays(today.value, 6)));
</script>
<template>
  <div class="home">
    <header class="home-head">
      <div>
        <h1>{{ greeting }}，{{ identity?.user.displayName }}</h1>
        <p>
          {{ date
          }}<template v-if="project"> · {{ project.name }} · {{ project.customerName }}</template>
        </p>
      </div>
      <div class="home-actions">
        <RouterLink
          v-if="may('delivery.overview:view')"
          to="/workspace/development-overview"
          class="secondary-button"
          ><AppIcon name="grid" :size="16" />开发概览</RouterLink
        >
        <RouterLink to="/workspace/development-items" class="primary-button"
          ><AppIcon name="file" :size="16" />打开开发清单</RouterLink
        >
      </div>
    </header>

    <BaseEmptyState
      v-if="!hasProject"
      title="先选择一个项目"
      text="工作台按当前项目汇总阶段、进度、风险与你的待办。在页头的项目切换器里选择项目；还没有加入项目时，请联系项目经理。"
      ><template #icon><AppIcon name="folder" :size="16" /></template
    ></BaseEmptyState>

    <div v-else-if="loading && !data" class="dash" aria-busy="true">
      <div class="dash-grid">
        <BaseSkeleton class="span-4" height="200px" />
        <BaseSkeleton class="span-5" height="200px" />
        <BaseSkeleton class="span-3" height="200px" />
        <BaseSkeleton class="span-8" height="260px" />
        <BaseSkeleton class="span-4" height="260px" />
      </div>
    </div>

    <div v-else class="dash">
      <p v-if="error" class="error-note" role="alert">
        {{ error }}<button class="text-button" @click="load">重新加载</button>
      </p>

      <!-- Personal layer first when the user has no project layer or something is overdue. -->
      <div v-if="personalFirst" class="dash-grid">
        <DashCard title="今天先做" :hint="`${data!.mine.todoTotal} 项`" :span="8">
          <template #icon><Flag /></template>
          <template #action>
            <button
              v-if="data!.mine.todoIds.length"
              class="dash-link"
              @click="drill({ ids: data!.mine.todoIds }, '我的待办')"
            >
              全部<ArrowRight />
            </button>
          </template>
          <ul class="dash-rows">
            <li v-for="t in todo.slice(0, 5)" :key="t.id + t.phase">
              <button class="dash-row" @click="openTodo(t)">
                <span class="dash-row-main">
                  <strong>{{ t.code }} {{ t.name }}</strong>
                  <small
                    >{{ t.module }} · {{ stageLabel(t.phase)
                    }}<template v-if="t.plannedEnd">
                      · 计划 {{ shortDate(t.plannedEnd) }}</template
                    ></small
                  >
                </span>
                <BaseTag v-if="t.risk" tone="red">风险</BaseTag>
                <BaseTag v-else-if="t.plannedEnd && t.plannedEnd <= today" tone="yellow"
                  >今天到期</BaseTag
                >
              </button>
            </li>
          </ul>
          <p v-if="!todo.length" class="dash-empty">今天没有到期的阶段。</p>
        </DashCard>
        <DashCard title="等我回应" :hint="`${respond.length} 项`" :span="4">
          <template #icon><MessageSquare /></template>
          <ul class="dash-rows">
            <li v-for="r in respond.slice(0, 5)" :key="r.id + r.type">
              <button class="dash-row" @click="open(itemLink(currentProject, r.id))">
                <span class="dash-row-main">
                  <strong>{{ r.code }} {{ r.name }}</strong>
                  <small
                    >{{ r.type === 'comment' ? '未回复的批注' : '待定稿' }} · {{ r.days }} 天</small
                  >
                </span>
              </button>
            </li>
          </ul>
          <p v-if="!respond.length" class="dash-empty">没有等你回应的批注。</p>
        </DashCard>
      </div>

      <template v-if="projectLayer && data">
        <div class="dash-grid">
          <DashCard tone="hero" title="项目阶段" :span="4">
            <template #icon><Flag /></template>
            <template #action>
              <RouterLink to="/settings/project/plan" class="dash-link"
                >计划与健康<ArrowRight
              /></RouterLink>
            </template>
            <div class="hero-phase">
              <span class="dash-number dash-rise">{{ phase.name }}</span>
              <span v-if="phase.index >= 0" class="hero-sub"
                >SAP Activate 第 {{ phase.index + 1 }} / {{ phase.steps.length }} 阶段</span
              >
            </div>
            <ol class="hero-steps" aria-label="实施阶段">
              <li v-for="s in phase.steps" :key="s.name" :class="s.state" :title="s.name">
                <span class="bar"></span><span class="name">{{ s.name }}</span>
              </li>
            </ol>
            <div class="hero-foot">
              <span v-if="phase.goLiveDays !== null" class="hero-golive">
                <strong>{{ Math.abs(phase.goLiveDays) }}</strong>
                {{ phase.goLiveDays >= 0 ? '天后上线' : '天前已过上线日' }}
                <small>{{ phase.goLive }}</small>
              </span>
              <span v-else class="hero-golive"><small>上线日期未排期</small></span>
              <span v-if="health" class="dash-trend"
                >自报 {{ HEALTH_LABELS[health.overall as 'green'] }}</span
              >
            </div>
          </DashCard>

          <div class="span-5 home-metrics">
            <DashMetric
              v-for="m in metrics"
              :key="m.id"
              :label="m.label"
              :value="m.value"
              :unit="m.unit"
              :tone="m.tone"
              :trend="m.trend"
              :sub="m.sub"
              :open="m.open"
              ><template #icon><component :is="m.icon" /></template
            ></DashMetric>
          </div>

          <DashCard tone="ink" title="本周要点" :hint="`至 ${weekEnd}`" :span="3">
            <template #icon><Sparkles /></template>
            <p class="ink-signal">
              <span class="signal-dot" :class="signal"></span>数据信号：{{
                { green: '正常', yellow: '关注', red: '风险' }[signal]
              }}
            </p>
            <ul class="dash-rows ink-points">
              <li v-for="(p, i) in points" :key="i">
                <span class="point-dot" :class="p.tone"></span>{{ p.text }}
              </li>
            </ul>
            <p v-if="!points.length" class="ink-calm">本周没有需要特别关注的事项。</p>
            <RouterLink to="/workspace/development-overview" class="dash-link ink-more"
              >查看开发概览与周报<ArrowRight
            /></RouterLink>
          </DashCard>
        </div>

        <div class="dash-grid">
          <DashCard
            title="交付趋势"
            hint="剩余 FSD 与开发人天，虚线为到开发冻结的理想线"
            :span="personalFirst || !personalLayer ? 12 : 8"
          >
            <template #icon><TrendingDown /></template>
            <DashArea
              v-if="trend"
              :values="trend.values"
              :labels="trend.labels"
              :target="trend.target"
              label="剩余人天趋势"
            />
            <p v-else class="dash-empty">开发清单积累一段时间的状态变化后，这里会画出趋势。</p>
          </DashCard>
          <DashCard
            v-if="!personalFirst && personalLayer"
            title="我的待办"
            :hint="`${data.mine.todoTotal} 项`"
            :span="4"
          >
            <template #icon><CalendarClock /></template>
            <ul class="dash-rows">
              <li v-for="t in todo.slice(0, 5)" :key="t.id + t.phase">
                <button class="dash-row" @click="openTodo(t)">
                  <span class="dash-row-main">
                    <strong>{{ t.code }} {{ t.name }}</strong>
                    <small
                      >{{ stageLabel(t.phase)
                      }}<template v-if="t.plannedEnd">
                        · {{ shortDate(t.plannedEnd) }}</template
                      ></small
                    >
                  </span>
                  <BaseTag v-if="t.risk" tone="red">风险</BaseTag>
                </button>
              </li>
              <li v-if="respond.length">
                <button
                  class="dash-row"
                  @click="drill({ ids: respond.map((r) => r.id) }, '等我回应')"
                >
                  <span class="dash-row-main"
                    ><strong>等我回应 {{ respond.length }} 项</strong
                    ><small>批注与待定稿</small></span
                  >
                </button>
              </li>
            </ul>
          </DashCard>
        </div>

        <div class="dash-grid">
          <DashCard title="近期里程碑" :span="4">
            <template #icon><Flag /></template>
            <ul class="dash-rows">
              <li v-for="m in milestones" :key="m.key" class="dash-row">
                <span class="dash-row-main"
                  ><strong>{{ m.name }}</strong
                  ><small>{{ m.date }}</small></span
                >
                <BaseTag :tone="m.tone">{{ m.when }}</BaseTag>
              </li>
            </ul>
            <p v-if="!milestones.length" class="dash-empty">没有待达成的已排期里程碑。</p>
          </DashCard>
          <DashCard title="模块 × 阶段" hint="完成率，红框为有风险" :span="team.length ? 5 : 8">
            <template #icon><Grid3x3 /></template>
            <div
              v-if="heat.length"
              class="heat"
              :style="{ gridTemplateColumns: `auto repeat(${heatPhases.length}, minmax(0, 1fr))` }"
            >
              <span></span>
              <span v-for="p in heatPhases" :key="p.key" class="heat-head">{{ p.label }}</span>
              <template v-for="r in heat" :key="r.module">
                <span class="heat-module">{{ r.module }}</span>
                <button
                  v-for="c in r.cells"
                  :key="c.key"
                  type="button"
                  class="dash-heat"
                  :class="[c.level, { risk: c.risk }]"
                  :title="c.hint"
                  :aria-label="c.hint"
                  :disabled="!c.total"
                  @click="drill({ module: r.module, phase: c.key }, r.module + ' · ' + c.label)"
                >
                  {{ c.text }}
                </button>
              </template>
            </div>
            <p v-else class="dash-empty">还没有开发项。</p>
          </DashCard>
          <DashCard v-if="team.length" title="团队负载" hint="本周计划人天" :span="3">
            <template #icon><Users /></template>
            <ul class="dash-rows">
              <li v-for="t in team" :key="t.name" class="load-row">
                <span class="load-name">{{ t.name }}</span>
                <span class="load-track"
                  ><span
                    class="load-fill"
                    :class="{ over: t.over }"
                    :style="{ width: t.width + '%' }"
                  ></span
                ></span>
                <span class="load-days" :class="{ over: t.over }">{{ t.days }}</span>
              </li>
            </ul>
            <RouterLink to="/workspace/development-load" class="dash-link"
              >开发排期<ArrowRight
            /></RouterLink>
          </DashCard>
        </div>
      </template>

      <!-- Without the project layer and without personal work: the way in. -->
      <div v-if="!projectLayer && !personalLayer" class="dash-grid">
        <DashCard title="从这里开始" :span="12">
          <ul class="dash-rows">
            <li v-for="s in shortcuts" :key="s.id">
              <RouterLink :to="s.path" class="dash-row">
                <span class="icon-tile"><AppIcon :name="s.icon" :size="16" /></span>
                <span class="dash-row-main"
                  ><strong>{{ s.label }}</strong
                  ><small>{{ s.description }}</small></span
                >
              </RouterLink>
            </li>
          </ul>
        </DashCard>
      </div>

      <div class="dash-grid">
        <DashCard title="即将推出" hint="知识与资产" :span="12">
          <ul class="coming">
            <li v-for="c in coming" :key="c.id">
              <span class="icon-tile"><AppIcon :name="c.icon" :size="16" /></span>
              <span class="dash-row-main"
                ><strong>{{ c.label }}</strong
                ><small>{{ c.description }}</small></span
              >
            </li>
          </ul>
        </DashCard>
      </div>
    </div>
  </div>
</template>
<style scoped>
.home {
  display: grid;
  gap: var(--space-5);
  max-width: 1600px;
  margin: 0 auto;
}
.home-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--space-4);
}
.home-head h1 {
  margin: 0;
  font-size: var(--font-32);
  font-weight: var(--weight-475);
  line-height: var(--leading-40);
  letter-spacing: -0.01em;
}
.home-head p {
  margin: var(--space-1) 0 0;
  color: var(--text-muted);
}
.home-actions {
  display: flex;
  gap: var(--space-2);
}
.home-actions .primary-button {
  border-radius: var(--radius-full);
  background: var(--dash-hero);
}
.home-actions .primary-button:hover {
  background: var(--dash-hero-hover);
}
.home-actions .secondary-button {
  border-radius: var(--radius-full);
}

/* Hero: the phase. */
.hero-phase {
  display: grid;
  gap: var(--space-0-5);
}
.hero-sub {
  color: var(--dash-on-hero-muted);
  font-size: var(--font-12);
}
.hero-steps {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: var(--space-1);
  margin: var(--space-2) 0 0;
  padding: 0;
  list-style: none;
}
.hero-steps li {
  display: grid;
  gap: var(--space-1);
}
.hero-steps .bar {
  height: 6px;
  border-radius: var(--radius-full);
  background: var(--dash-hero-track);
}
.hero-steps .done .bar,
.hero-steps .now .bar {
  background: var(--dash-on-hero);
}
.hero-steps .name {
  color: var(--dash-on-hero-muted);
  font-size: var(--font-11);
  text-align: center;
}
.hero-steps .now .name {
  color: var(--dash-on-hero);
  font-weight: var(--weight-550);
}
.hero-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  margin-top: auto;
}
.hero-golive {
  display: flex;
  align-items: baseline;
  gap: var(--space-1);
}
.hero-golive strong {
  font-size: var(--font-24);
  font-weight: var(--weight-475);
  font-variant-numeric: tabular-nums;
}
.hero-golive small {
  color: var(--dash-on-hero-muted);
  font-size: var(--font-12);
}

/* The 2 × 2 key numbers. */
.home-metrics {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-4);
}

/* Ink: this week. */
.ink-signal {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: 0;
  font-size: var(--font-14);
}
.signal-dot,
.point-dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: var(--radius-full);
}
.signal-dot.green {
  background: var(--green-solid-1);
}
.signal-dot.yellow,
.point-dot.yellow {
  background: var(--yellow-solid-1);
}
.signal-dot.red,
.point-dot.red {
  background: var(--red-solid-1);
}
.point-dot.blue {
  background: var(--blue-icon-1);
}
.ink-points li {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  padding: var(--space-2) 0;
  font-size: var(--font-12);
  line-height: var(--leading-20);
}
.ink-points .point-dot {
  transform: translateY(-1px);
}
.ink-calm {
  margin: 0;
  color: var(--dash-on-ink-muted);
  font-size: var(--font-12);
}
.ink-more {
  margin-top: auto;
}

/* Heat map. */
.heat {
  display: grid;
  gap: var(--space-1);
  align-items: center;
}
.heat-head {
  color: var(--text-muted);
  font-size: var(--font-11);
  text-align: center;
}
.heat-module {
  padding-right: var(--space-2);
  font-size: var(--font-12);
  font-weight: var(--weight-475);
}
.dash-heat:disabled {
  color: var(--text-subtle);
  cursor: default;
}

/* Team load. */
.load-row {
  display: grid;
  grid-template-columns: 6em minmax(0, 1fr) 2.5em;
  align-items: center;
  gap: var(--space-2);
  min-height: var(--control-menu-item);
  font-size: var(--font-12);
}
.load-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.load-track {
  height: 6px;
  border-radius: var(--radius-full);
  background: var(--chart-track);
  overflow: hidden;
}
.load-fill {
  display: block;
  height: 100%;
  border-radius: var(--radius-full);
  background: var(--chart-1);
}
.load-fill.over {
  background: var(--chart-5);
}
.load-days {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.load-days.over {
  color: var(--red-text-2);
}

/* Coming soon. */
.coming {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr));
  gap: var(--space-4);
  margin: 0;
  padding: 0;
  list-style: none;
}
.coming li {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
}
@media (max-width: 760px) {
  .home-metrics {
    grid-template-columns: 1fr;
  }
}
</style>
