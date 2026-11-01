<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  Flag,
  Lock,
  MessageSquare,
} from '@lucide/vue';
import { PHASES as ITEM_PHASES } from '@sap-delivery-workbench/contracts/delivery/fields';
import { daysBetween, addDays } from '@sap-delivery-workbench/contracts/delivery/overview';
import {
  HEALTH as HEALTH_LABELS,
  PHASES as PROJECT_PHASES,
} from '@sap-delivery-workbench/contracts/projects/options';
import AppIcon from '../components/AppIcon.vue';
import BaseEmptyState from '../components/base/BaseEmptyState.vue';
import BaseSkeleton from '../components/base/BaseSkeleton.vue';
import BaseTag from '../components/base/BaseTag.vue';
import DashArea from '../components/dashboard/DashArea.vue';
import DashCard from '../components/dashboard/DashCard.vue';
import { type Trend } from '../components/dashboard/DashMetric.vue';
import MilestoneRail from '../components/dashboard/MilestoneRail.vue';
import {
  assistantLink,
  drillLink,
  itemLink,
  openFrom,
  pct,
  shortDate,
  type Overview,
} from '../features/development-overview/model';
import { menus, upcoming } from '../features/navigation';
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

// The ring of finished development and the pace against the freeze (DESIGN.md 12.4).
const ring = computed(() => {
  const d = data.value;
  const done = d?.counts.developmentDone ?? 0;
  const total = d?.counts.items ?? 0;
  return { done, total, arc: total ? (2 * Math.PI * 66 * done) / total : 0 };
});
const pace = computed(() => {
  const p = data.value?.flow.pace;
  const recent = p?.recentPerWeek ?? 0;
  const required = p?.requiredPerWeek ?? null;
  const share = required ? Math.max(8, Math.min(100, Math.round((recent / required) * 100))) : 100;
  return { recent, required, share };
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

// AI 效能 (roadmap 2.3, user 2026-11-01): output counts only, no saved-effort estimate.
const ai = computed(() => {
  const a = data.value?.development.ai;
  if (!a) return null;
  return [
    {
      label: '助手参与的开发项',
      value: a.assisted,
      unit: ` / ${a.items}`,
      sub: `覆盖 ${pct(a.assisted, a.items)}%`,
      share: pct(a.assisted, a.items),
    },
    { label: 'FSD 定稿', value: a.fsdFinal, unit: '项', sub: '设计助手产出并定稿', share: null },
    { label: '代码定稿', value: a.codeFinal, unit: '项', sub: '开发助手产出并定稿', share: null },
    {
      label: '产出版本',
      value: a.versions,
      unit: '版',
      sub: `本周 +${a.versionsWeek} · 对话 ${a.turns} 轮（本周 ${a.turnsWeek}）`,
      share: null,
    },
  ];
});

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

// The heat map takes the room the to-do and team cards leave in their row.
const heatSpan = computed(
  () => 12 - (!personalFirst.value && personalLayer.value ? 3 : 0) - (team.value.length ? 3 : 0),
);

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
const coming = upcoming.filter((u) => u.path.startsWith('/workspace/'));
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
        <!-- The band (DESIGN.md 12.4): the Activate phases as pills, then three big numbers. -->
        <section class="band" aria-label="项目进度">
          <ol class="phases" aria-label="实施阶段">
            <li v-for="s in phase.steps" :key="s.name" :class="s.state || 'left'">
              <span class="phase-name">{{ s.name }}</span>
              <span class="dash-pill" :class="s.state || 'left'"
                ><template v-if="s.state === 'done'">已完成</template
                ><template v-else-if="s.state === 'now'"
                  >进行中<template v-if="health">
                    · 自报{{ HEALTH_LABELS[health.overall as 'green'] }}</template
                  ></template
                ></span
              >
            </li>
          </ol>
          <div class="figures">
            <button type="button" class="figure dash-rise" @click="metrics[0]!.open?.()">
              <span class="figure-value">{{ metrics[0]!.value }}<small>%</small></span>
              <span class="figure-label">开发完成 · {{ ring.done }} / {{ ring.total }}</span>
            </button>
            <button
              v-if="data.cards.freeze.date"
              type="button"
              class="figure dash-rise"
              @click="metrics[2]!.open?.()"
            >
              <span class="figure-value"
                >{{ metrics[2]!.value }}<small>{{ metrics[2]!.unit }}</small></span
              >
              <span class="figure-label">开发冻结 · {{ shortDate(data.cards.freeze.date) }}</span>
            </button>
            <RouterLink
              v-if="phase.goLiveDays !== null"
              to="/project/plan"
              class="figure dash-rise"
            >
              <span class="figure-value"
                >{{ Math.abs(phase.goLiveDays)
                }}<small>{{ phase.goLiveDays >= 0 ? '天后' : '天前' }}</small></span
              >
              <span class="figure-label">上线 · {{ shortDate(phase.goLive!) }}</span>
            </RouterLink>
          </div>
        </section>

        <div class="dash-grid">
          <DashCard title="交付趋势" hint="剩余 FSD 与开发人天，虚线为到冻结的理想线" :span="3">
            <template #action>
              <RouterLink
                to="/workspace/development-overview"
                class="dash-open"
                aria-label="打开开发概览"
                ><ArrowUpRight
              /></RouterLink>
            </template>
            <DashArea
              v-if="trend"
              :values="trend.values"
              :labels="trend.labels"
              :target="trend.target"
              label="剩余人天趋势"
            />
            <p v-else class="dash-empty">开发清单积累一段时间的状态变化后，这里会画出趋势。</p>
          </DashCard>

          <DashCard title="开发完成" :span="3">
            <template #action>
              <button
                type="button"
                class="dash-open"
                aria-label="打开已完成的开发项"
                @click="metrics[0]!.open?.()"
              >
                <ArrowUpRight />
              </button>
            </template>
            <div class="donut" role="img" :aria-label="`开发完成 ${ring.done} / ${ring.total} 项`">
              <svg viewBox="0 0 180 180" aria-hidden="true">
                <circle class="donut-ticks" cx="90" cy="90" r="84" />
                <circle class="donut-track" cx="90" cy="90" r="66" />
                <circle
                  class="donut-value"
                  cx="90"
                  cy="90"
                  r="66"
                  :stroke-dasharray="`${ring.arc} 999`"
                  transform="rotate(-90 90 90)"
                />
              </svg>
              <span class="donut-text"
                ><strong>{{ ring.done }} / {{ ring.total }}</strong
                ><small>项开发完成</small></span
              >
            </div>
            <button
              type="button"
              class="dash-link risk-link"
              :class="{ alert: data.cards.risk.count }"
              @click="metrics[1]!.open?.()"
            >
              风险开发项 {{ data.cards.risk.count }} · 逾期未更新 {{ data.cards.risk.stale }}
            </button>
          </DashCard>

          <DashCard title="冻结前节奏" :span="3">
            <template #action>
              <span class="pace-now">{{ pace.recent }}<small>人天/周</small></span>
            </template>
            <div class="pace">
              <div class="pace-legend">
                <span>近 4 周均值</span
                ><span v-if="pace.required !== null">冻结前需 {{ pace.required }}</span>
              </div>
              <div class="pace-bar">
                <span class="dash-pill now" :style="{ flexBasis: pace.share + '%' }">{{
                  pace.recent
                }}</span>
                <span v-if="pace.share < 100" class="dash-pill left pace-rest"></span>
              </div>
              <div class="dash-pill done pace-week">
                本周完成 {{ metrics[3]!.value }} 人天
                <span v-if="metrics[3]!.trend" class="pace-trend">{{
                  metrics[3]!.trend!.text
                }}</span>
              </div>
            </div>
            <button
              v-if="data.cards.freeze.date"
              type="button"
              class="dash-link pace-foot"
              @click="metrics[2]!.open?.()"
            >
              {{ metrics[2]!.sub }}
            </button>
          </DashCard>

          <DashCard tone="ink" title="本周要点" :hint="`至 ${weekEnd}`" :span="3">
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
          <DashCard title="里程碑" :span="ai ? 9 : 12">
            <template #action>
              <RouterLink to="/project/plan" class="dash-open" aria-label="打开计划与健康"
                ><ArrowUpRight
              /></RouterLink>
            </template>
            <MilestoneRail :milestones="data.milestones" :today="today" :cards="4" />
          </DashCard>
          <DashCard v-if="ai" title="AI 效能" hint="助手为本项目产出的成果，只计数量" :span="3">
            <ul class="dash-rows ai-rows">
              <li v-for="(a, i) in ai" :key="a.label" class="dash-rise">
                <span class="ai-row">
                  <span class="ai-label"
                    >{{ a.label }}<small>{{ a.sub }}</small></span
                  >
                  <span class="ai-value"
                    >{{ a.value }}<small>{{ a.unit }}</small></span
                  >
                </span>
                <span v-if="i === 0" class="ai-bar"
                  ><span :style="{ width: Math.min(100, a.share ?? 0) + '%' }"></span
                ></span>
              </li>
            </ul>
          </DashCard>
        </div>

        <div class="dash-grid">
          <DashCard
            v-if="!personalFirst && personalLayer"
            title="我的待办"
            :hint="`${data.mine.todoTotal} 项`"
            :span="3"
          >
            <ul class="dash-rows">
              <li v-for="t in todo.slice(0, 5)" :key="t.id + t.phase">
                <button class="dash-row" @click="openTodo(t)">
                  <span class="todo-code">{{ t.code }}</span>
                  <span class="dash-row-main">
                    <strong>{{ t.name }}</strong>
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
          <DashCard title="模块 × 阶段" hint="完成率，红框为有风险" :span="heatSpan">
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
            <template #action>
              <RouterLink
                to="/workspace/development-load"
                class="dash-open"
                aria-label="打开开发排期"
                ><ArrowUpRight
              /></RouterLink>
            </template>
            <ul class="dash-rows load-rows">
              <li v-for="t in team" :key="t.name" class="load-row">
                <span class="load-name">{{ t.name }}</span>
                <span class="load-track"
                  ><span
                    v-if="t.days"
                    class="load-fill"
                    :class="{ over: t.over }"
                    :style="{ width: t.width + '%' }"
                  ></span
                ></span>
                <span class="load-days" :class="{ over: t.over }">{{ t.days }}</span>
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

      <div v-if="!projectLayer" class="dash-grid">
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
  gap: var(--space-6);
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
/* The greeting is the page's headline: large and thin (DESIGN.md 12.4). */
.home-head h1 {
  margin: 0;
  font-size: var(--font-48);
  font-weight: var(--weight-300);
  line-height: var(--leading-56);
  letter-spacing: -0.02em;
}
.home-head p {
  margin: var(--space-2) 0 0;
  color: var(--text-muted);
}
.home-actions {
  display: flex;
  gap: var(--space-2);
}

/* The band: phase pills and the three big numbers. */
.band {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: var(--space-8);
}
.phases {
  display: flex;
  flex: 3 1 560px;
  gap: var(--space-1-5);
  min-width: 0;
  margin: 0;
  padding: 0;
  list-style: none;
}
.phases li {
  display: grid;
  flex: 1 1 0;
  gap: var(--space-2);
  min-width: 0;
}
.phases li.now {
  flex-grow: 2.4;
}
.phase-name {
  color: var(--text-muted);
  font-size: var(--font-12);
}
.phases .now .phase-name {
  color: var(--text);
  font-weight: var(--weight-475);
}
.phases .dash-pill {
  overflow: hidden;
  text-overflow: ellipsis;
}
.figures {
  display: flex;
  flex: 1 1 360px;
  justify-content: flex-end;
  gap: var(--space-8);
}
.figure {
  display: grid;
  gap: var(--space-2);
  padding: 0;
  border: 0;
  border-radius: var(--radius-8);
  background: none;
  color: var(--text);
  font: inherit;
  text-align: left;
  text-decoration: none;
  cursor: pointer;
}
.figure:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: var(--space-1);
}
.figure-value {
  font-size: var(--font-64);
  font-weight: var(--weight-200);
  line-height: var(--leading-64);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.04em;
}
.figure-value small {
  margin-left: var(--space-1);
  font-size: var(--font-20);
  font-weight: var(--weight-400);
  letter-spacing: 0;
}
.figure-label {
  color: var(--text-muted);
  font-size: var(--font-12);
}
.figure:hover .figure-label {
  color: var(--text);
}

/* The ring of finished development. */
.donut {
  position: relative;
  width: min(100%, 180px);
  aspect-ratio: 1;
  margin: 0 auto;
}
.donut svg {
  width: 100%;
  height: 100%;
}
.donut circle {
  fill: none;
}
.donut-ticks {
  stroke: var(--border-emphasis);
  stroke-width: 1.5;
  stroke-dasharray: 1.5 7;
}
.donut-track {
  stroke: var(--neutral-fill-2);
  stroke-width: 16;
}
.donut-value {
  stroke: var(--accent);
  stroke-width: 16;
  stroke-linecap: round;
}
.donut-text {
  position: absolute;
  inset: 0;
  display: grid;
  place-content: center;
  justify-items: center;
}
.donut-text strong {
  font-size: var(--font-32);
  font-weight: var(--weight-300);
  line-height: var(--leading-40);
  font-variant-numeric: tabular-nums;
}
.donut-text small {
  color: var(--text-muted);
  font-size: var(--font-12);
}
.risk-link {
  justify-content: center;
  margin-top: auto;
  color: var(--text-muted);
}
.risk-link.alert {
  color: var(--red-text-2);
}

/* The pace against the freeze. */
.pace-now {
  font-size: var(--font-32);
  font-weight: var(--weight-300);
  line-height: var(--leading-40);
  font-variant-numeric: tabular-nums;
}
.pace-now small {
  margin-left: var(--space-1);
  color: var(--text-muted);
  font-size: var(--font-12);
}
.pace {
  display: grid;
  gap: var(--space-2);
}
.pace-legend {
  display: flex;
  justify-content: space-between;
  color: var(--text-muted);
  font-size: var(--font-12);
}
.pace-bar {
  display: flex;
  gap: var(--space-1);
}
.pace-bar .now {
  flex-shrink: 0;
}
.pace-rest {
  flex: 1;
  padding: 0;
}
.pace-week {
  justify-content: space-between;
}
.pace-trend {
  color: var(--dash-on-ink-muted);
}
.pace-foot {
  margin-top: auto;
  color: var(--text-muted);
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
  background: var(--accent);
}
.ink-points li {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  padding: var(--space-2) 0;
  font-size: var(--font-14);
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
  color: var(--dash-on-ink-muted);
}

/* My work: the code in mono before the name. */
.todo-code {
  flex: none;
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: var(--font-12);
}

/* AI output as rows with big thin numbers. */
.ai-rows li {
  display: grid;
  gap: var(--space-2);
  padding: var(--space-3) 0;
}
.ai-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-3);
}
.ai-label {
  display: grid;
  gap: var(--space-0-5);
  min-width: 0;
}
.ai-label small {
  color: var(--text-muted);
  font-size: var(--font-12);
}
.ai-value {
  flex: none;
  font-size: var(--font-24);
  font-weight: var(--weight-300);
  line-height: var(--leading-32);
  font-variant-numeric: tabular-nums;
}
.ai-value small {
  margin-left: var(--space-0-5);
  color: var(--text-muted);
  font-size: var(--font-12);
  font-weight: var(--weight-400);
}
.ai-bar {
  height: 6px;
  border-radius: var(--radius-full);
  background: var(--neutral-fill-2);
  overflow: hidden;
}
.ai-bar span {
  display: block;
  height: 100%;
  border-radius: var(--radius-full);
  background: var(--primary);
}

/* Heat map. */
.heat {
  display: grid;
  gap: var(--space-1-5);
  align-items: center;
}
.heat-head {
  color: var(--text-muted);
  font-size: var(--font-12);
  text-align: center;
}
.heat-module {
  padding-right: var(--space-2);
  font-size: var(--font-14);
  font-weight: var(--weight-475);
}
.dash-heat:disabled {
  color: var(--text-subtle);
  cursor: default;
}

/* Team load: pill bars, ink when planned, striped when empty, red when over. */
.load-rows li {
  border-top: 0;
}
.load-row {
  display: grid;
  grid-template-columns: 6em minmax(0, 1fr) 2.5em;
  align-items: center;
  gap: var(--space-2);
  min-height: var(--control-button);
  font-size: var(--font-14);
}
.load-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.load-track {
  height: var(--space-6);
  border-radius: var(--radius-full);
  background: var(--hatch);
  box-shadow: inset 0 0 0 1px var(--border);
  overflow: hidden;
}
.load-fill {
  display: block;
  height: 100%;
  border-radius: var(--radius-full);
  background: var(--primary);
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

/* Coming soon (without the project layer it spans the row). */
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
@media (max-width: 1280px) {
  .figures {
    justify-content: flex-start;
  }
}
@media (max-width: 760px) {
  .home-head h1 {
    font-size: var(--font-32);
    line-height: var(--leading-40);
  }
  .phases {
    flex-wrap: wrap;
  }
  .phases li {
    flex-basis: 30%;
  }
  .figures {
    flex-wrap: wrap;
    gap: var(--space-5);
  }
  .figure-value {
    font-size: var(--font-48);
    line-height: var(--leading-56);
  }
}
</style>
