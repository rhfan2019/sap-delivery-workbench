<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { OPTIONS, PHASES, type PhaseKey } from '@sap-delivery-workbench/contracts/delivery/fields';
import {
  RISK_SOURCES,
  type OverviewFilter,
} from '@sap-delivery-workbench/contracts/delivery/overview';
import BaseAvatar from '../../components/base/BaseAvatar.vue';
import BaseTag from '../../components/base/BaseTag.vue';
import { moduleHue } from '../../components/base/identity';
import { currentProject } from '../../services/projectContext';
import BurnChart from './BurnChart.vue';
import FlowChart from './FlowChart.vue';
import { openFrom, HEALTH, itemLink, shortDate, type Overview, type Reason } from './model';

// The project view (spec section 2, project manager): phase × status, this week's attention
// list, team load and the budget.
const props = defineProps<{
  data: Overview;
  drill: (filter: OverviewFilter, label: string) => void;
}>();
const router = useRouter();
const STATUSES = Object.entries(OPTIONS.status) as [string, string][];
const phaseLabel = (key: PhaseKey) => PHASES.find((p) => p.key === key)?.label ?? key;
const open = (id: string) => void openFrom(router, itemLink(currentProject.value, id));

function reasonText(r: Reason) {
  if (r.type === 'idle') return { tone: 'yellow' as const, text: `${r.days} 天无动静` };
  if (r.type === 'drift')
    return { tone: 'yellow' as const, text: `${phaseLabel(r.phase)}计划后推 ${r.days} 天` };
  const late = r.days && r.days > 0 ? ` ${r.days} 天` : '';
  return {
    tone: 'red' as const,
    text: `${phaseLabel(r.phase)}${RISK_SOURCES[r.source]}${r.source === 'stale' ? late : ''}`,
  };
}
const owners = (reasons: Reason[]) => [
  ...new Set(reasons.flatMap((r) => (r.type === 'risk' && r.assignee ? [r.assignee] : []))),
];

// Team load: a week holds five working days; above that the cell is outlined in red.
const load = computed(() => props.data.load);
const shade = (days: number) =>
  days <= 0
    ? ''
    : days <= 2
      ? 'var(--blue-fill-1)'
      : days <= 4
        ? 'var(--blue-fill-2)'
        : 'var(--blue-fill-3)';
const budget = computed(() => {
  const b = props.data.budget;
  if (!b?.budgetDays) return null;
  const pct = (n: number) => Math.min(100, Math.round((n / b.budgetDays!) * 100));
  return {
    ...b,
    planned: pct(b.plannedDays),
    done: pct(b.doneDays),
    over: b.plannedDays > b.budgetDays,
  };
});
const modules = computed(() => props.data.modules);
</script>
<template>
  <div class="ov-cols">
    <section class="ov-section">
      <h2>阶段 × 状态<small>点数字打开对应的开发项</small></h2>
      <div class="ov-card">
        <table class="ov-table">
          <thead>
            <tr>
              <th>阶段</th>
              <th v-for="[key, label] in STATUSES" :key="key" class="num">{{ label }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in PHASES" :key="p.key">
              <td class="main">{{ p.label }}</td>
              <td v-for="[key, label] in STATUSES" :key="key" class="num">
                <button
                  type="button"
                  class="ov-cell-button"
                  :disabled="!data.matrix[p.key][key]"
                  @click="drill({ phase: p.key, status: key }, p.label + '：' + label)"
                >
                  {{ data.matrix[p.key][key] ?? 0 }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="ov-section">
      <h2>模块进度<small>已完成 / 总数，红字为风险数</small></h2>
      <div class="ov-card">
        <table class="ov-table">
          <thead>
            <tr>
              <th>模块</th>
              <th v-for="p in PHASES" :key="p.key" class="num">{{ p.label }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in modules" :key="m">
              <td>
                <BaseTag :tone="moduleHue(m)">{{ m }}</BaseTag>
              </td>
              <td v-for="p in PHASES" :key="p.key" class="num">
                <button
                  type="button"
                  class="ov-cell-button"
                  @click="drill({ module: m, phase: p.key }, m + ' · ' + p.label)"
                >
                  {{ data.moduleMatrix[m][p.key].completed }}/{{
                    data.moduleMatrix[m][p.key].total
                  }}
                </button>
                <button
                  v-if="data.moduleMatrix[m][p.key].risk"
                  type="button"
                  class="ov-cell-button risk"
                  @click="
                    drill({ module: m, phase: p.key, risk: 'any' }, m + ' · ' + p.label + '风险')
                  "
                >
                  {{ data.moduleMatrix[m][p.key].risk }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>

  <div class="ov-cols">
    <section class="ov-section">
      <h2>累积流<small>每天各状态的开发项数，由阶段状态流水回放</small></h2>
      <FlowChart :flow="data.flow" />
    </section>
    <section class="ov-section">
      <h2>燃尽与冻结倒推<small>FSD 与开发阶段未完成的人天（按当前预估）</small></h2>
      <BurnChart :flow="data.flow" />
    </section>
  </div>

  <section class="ov-section">
    <h2>
      本周关注<small
        >风险、7 天无动静、近 7 天计划后推的开发项{{
          data.attentionTotal > data.attention.length
            ? `，显示前 ${data.attention.length} / ${data.attentionTotal} 项`
            : ''
        }}</small
      >
    </h2>
    <div class="ov-card">
      <p v-if="!data.attention.length" class="ov-empty">本周没有需要特别关注的开发项。</p>
      <table v-else class="ov-table">
        <thead>
          <tr>
            <th>编号</th>
            <th>开发名称</th>
            <th>模块</th>
            <th>原因</th>
            <th>负责人</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="a in data.attention" :key="a.id" class="link" @click="open(a.id)">
            <td class="code">{{ a.code }}</td>
            <td class="main">{{ a.name }}</td>
            <td>
              <BaseTag :tone="moduleHue(a.module)">{{ a.module }}</BaseTag>
            </td>
            <td>
              <span class="ov-tags">
                <BaseTag v-for="(r, index) in a.reasons" :key="index" :tone="reasonText(r).tone">{{
                  reasonText(r).text
                }}</BaseTag>
              </span>
            </td>
            <td>
              <span class="ov-tags">
                <span v-for="name in owners(a.reasons)" :key="name" class="person"
                  ><BaseAvatar :name="name" :size="20" />{{ name }}</span
                >
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>

  <div class="ov-cols">
    <section v-if="data.team" class="ov-section wide">
      <h2>团队负载<small>按计划区间平摊的人天，每周超过 5 天描红</small></h2>
      <div class="ov-card scroll">
        <p v-if="!load.rows.length" class="ov-empty">还没有分配负责人的未完成阶段。</p>
        <table v-else class="ov-table load">
          <thead>
            <tr>
              <th>成员</th>
              <th class="num">未完成</th>
              <th v-for="w in load.weeks" :key="w" class="num">{{ shortDate(w) }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in load.rows" :key="r.userId ?? 'others'">
              <td>
                <span class="person"><BaseAvatar :name="r.name" :size="20" />{{ r.name }}</span>
              </td>
              <td class="num">
                <button
                  v-if="r.userId"
                  type="button"
                  class="ov-cell-button"
                  @click="drill({ assignee: r.userId }, r.name + ' 负责')"
                >
                  {{ r.open }}
                </button>
                <template v-else>{{ r.open }}</template>
              </td>
              <td
                v-for="(d, i) in r.days"
                :key="i"
                class="num cell"
                :class="{ over: d > 5 }"
                :style="{ background: shade(d) }"
              >
                {{ d ? d : '' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
  <div class="ov-cols">
    <section class="ov-section">
      <h2>
        计划漂移<small
          >与基线（第一次填写的计划完成日）相比后推的阶段：{{ data.planDrift.drifted }} /
          {{ data.planDrift.planned }}，累计 {{ data.planDrift.totalDays }} 天</small
        >
      </h2>
      <div class="ov-card">
        <p v-if="!data.planDrift.top.length" class="ov-empty">没有比基线后推的计划。</p>
        <table v-else class="ov-table">
          <thead>
            <tr>
              <th>编号</th>
              <th>开发名称</th>
              <th>阶段</th>
              <th>基线 → 现在</th>
              <th class="num">后推</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="d in data.planDrift.top"
              :key="d.id + d.phase"
              class="link"
              @click="open(d.id)"
            >
              <td class="code">{{ d.code }}</td>
              <td class="main">{{ d.name }}</td>
              <td>{{ phaseLabel(d.phase) }}</td>
              <td>{{ shortDate(d.baselineEnd) }} → {{ shortDate(d.plannedEnd) }}</td>
              <td class="num">{{ d.days }} 天</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section v-if="data.commercial" class="ov-section">
      <h2>人天预算<small>FSD 与开发阶段的预估人天，不是实际工时</small></h2>
      <div class="ov-card budget">
        <p v-if="!budget" class="ov-empty">
          项目未设开发人天预算。已计划 {{ data.budget?.plannedDays ?? 0 }} 人天。
        </p>
        <template v-else>
          <div class="ov-bar">
            <span class="line"
              >已计划<strong
                >{{ budget.plannedDays }} / {{ budget.budgetDays }} 人天（{{
                  Math.round((budget.plannedDays / budget.budgetDays!) * 100)
                }}%）</strong
              ></span
            >
            <span class="track"
              ><span
                class="fill"
                :class="{ red: budget.over }"
                :style="{ width: budget.planned + '%' }"
              ></span
            ></span>
          </div>
          <div class="ov-bar">
            <span class="line"
              >已完成阶段<strong
                >{{ budget.doneDays }} / {{ budget.budgetDays }} 人天（{{ budget.done }}%）</strong
              ></span
            >
            <span class="track"
              ><span class="fill green" :style="{ width: budget.done + '%' }"></span
            ></span>
          </div>
        </template>
        <p v-if="data.guards.effortMedian.recent !== null" class="ov-note">
          单项人天中位数：近 30 天新增 {{ data.guards.effortMedian.recent }} 天，此前
          {{ data.guards.effortMedian.earlier ?? '—' }} 天{{
            data.guards.effortMedian.earlier !== null &&
            data.guards.effortMedian.recent < data.guards.effortMedian.earlier / 2
              ? '（新增项明显变小，留意是否拆项）'
              : ''
          }}
        </p>
      </div>
    </section>

    <section class="ov-section">
      <h2>数据信号<small>由风险占比、开发冻结、预算与更新频率算出，可与自报健康度对照</small></h2>
      <div class="ov-card signal">
        <span class="ov-tags"
          ><BaseTag :tone="data.signal.color">{{ HEALTH[data.signal.color] }}</BaseTag
          ><span class="ov-note">{{
            data.freshness.days === null
              ? '开发清单还没有更新记录'
              : data.freshness.days === 0
                ? '开发清单今天有更新'
                : `开发清单 ${data.freshness.days} 天前更新`
          }}</span></span
        >
        <ul v-if="data.signal.reasons.length" class="reasons">
          <li v-for="r in data.signal.reasons" :key="r.text">
            <BaseTag :tone="r.level">{{ r.level === 'red' ? '风险' : '关注' }}</BaseTag
            >{{ r.text }}
          </li>
        </ul>
        <p v-else class="ov-note">没有触发任何信号规则。</p>
      </div>
    </section>
  </div>
</template>
<style scoped>
.person {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1-5);
  white-space: nowrap;
}
.risk {
  color: var(--red-text-2);
}
.load .cell {
  font-size: var(--font-12);
}
.load .cell.over {
  box-shadow: inset 0 0 0 1px var(--red-border-3);
}
.wide {
  grid-column: 1 / -1;
}
.signal {
  display: grid;
  gap: var(--space-3);
}
.reasons {
  display: grid;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}
.reasons li {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.budget {
  display: grid;
  gap: var(--space-4);
}
</style>
