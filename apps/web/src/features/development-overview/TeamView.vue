<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { PHASES } from '@sap-delivery-workbench/contracts/delivery/fields';
import type { OverviewFilter } from '@sap-delivery-workbench/contracts/delivery/overview';
import BaseTag from '../../components/base/BaseTag.vue';
import { moduleHue } from '../../components/base/identity';
import { toast } from '../../components/base/toast';
import { api } from '../../services/session';
import { currentProject } from '../../services/projectContext';
import AwaitingTest from './AwaitingTest.vue';
import { openFrom, itemLink, pct, shortDate, type Brief, type Overview } from './model';

// The development team view (spec section 2, development lead): the handover radar (final FSDs
// waiting for a developer, with their objects), work in progress age (M12), developed items
// waiting for the test, SAP objects shared by open items, FSD finalization and how far the
// development assistant is used (M14).
const props = defineProps<{
  data: Overview;
  drill: (filter: OverviewFilter, label: string) => void;
  reload: () => void;
}>();
const router = useRouter();
const open = (id: string) => void openFrom(router, itemLink(currentProject.value, id));
const ids = (list: Brief[]) => ({ ids: list.map((i) => i.id) });
const dev = computed(() => props.data.development);
const cards = computed(() => [
  {
    id: 'handover',
    label: '可派开发',
    value: dev.value.handover.length,
    tone: '',
    sub: 'FSD 已定稿、开发未开始',
    open: () => props.drill(ids(dev.value.handover), '可派开发'),
  },
  {
    id: 'reverse',
    label: '先开发后定稿',
    value: dev.value.reverse.length,
    tone: dev.value.reverse.length ? 'yellow' : '',
    sub: '开发进行中，FSD 还没有定稿版本',
    open: () => props.drill(ids(dev.value.reverse), '先开发后定稿'),
  },
  {
    id: 'conflicts',
    label: '共用对象',
    value: dev.value.conflicts.length,
    tone: dev.value.conflicts.length ? 'yellow' : '',
    sub: '同一 SAP 对象挂在多个未交付的开发项上',
    open: () =>
      props.drill(
        { ids: [...new Set(dev.value.conflicts.flatMap((c) => c.items.map((i) => i.id)))] },
        '共用对象',
      ),
  },
  {
    id: 'awaiting',
    label: '开发完成待测',
    value: dev.value.awaitingTest.length,
    tone: '',
    sub: '开发已完成，顾问测试未开始',
    open: () => props.drill({ awaiting: true }, '开发完成待测'),
  },
]);

// 交接雷达: hand an item to a developer from here; the item API checks the edit permission.
const assigning = ref('');
async function assign(item: Brief, userId: string) {
  if (!userId) return;
  const base = `/projects/${currentProject.value}/development-items/${item.id}`;
  assigning.value = item.id;
  try {
    const current = await api<{ rowVersion: string }>(base);
    await api(
      base,
      { rowVersion: current.rowVersion, changes: { 'development.assigneeId': userId } },
      'PATCH',
    );
    toast(`${item.code} 已指派开发人员。`, 'green');
    props.reload();
  } catch (e) {
    toast((e as Error).message, 'red');
  } finally {
    assigning.value = '';
  }
}

// M12: one row per phase, a dot per open phase at its age.
const agingRows = computed(() =>
  PHASES.map((p) => ({ key: p.key, label: p.label, ...dev.value.aging[p.key] })),
);
const maxAge = computed(() =>
  Math.max(10, ...agingRows.value.flatMap((r) => r.points.map((x) => x.days))),
);
const x = (days: number) => `calc(${(days / maxAge.value) * 100}% - 5px)`;

const finalRate = computed(() => {
  const f = dev.value.fsdFinal;
  return {
    total: { ...f, pct: pct(f.final, f.total) },
    modules: Object.entries(f.byModule).map(([m, v]) => ({
      module: m,
      ...v,
      pct: pct(v.final, v.total),
    })),
  };
});
const coverageRows = computed(() => [
  { label: '用过开发助手', value: dev.value.coverage.session },
  { label: '有定稿代码', value: dev.value.coverage.final },
  { label: '有从 SAP 取回的版本', value: dev.value.coverage.sap },
]);
</script>
<template>
  <section class="ov-section" aria-label="开发组">
    <div class="ov-stats">
      <button v-for="c in cards" :key="c.id" type="button" class="ov-card ov-stat" @click="c.open">
        <span class="label">{{ c.label }}</span>
        <span class="value" :class="c.tone">{{ c.value }}</span>
        <span class="sub">{{ c.sub }}</span>
      </button>
    </div>
  </section>

  <section class="ov-section">
    <h2>
      交接雷达<small
        >FSD 已定稿、开发未开始，按等待天数排序，附涉及的对象（黄色为与其他开发项共用）{{
          dev.handover.some((h) => h.estimated) ? '；标“估算”的定稿日期取自版本生成时间' : ''
        }}</small
      >
    </h2>
    <div class="ov-card scroll">
      <p v-if="!dev.handover.length" class="ov-empty">没有等待指派开发的已定稿 FSD。</p>
      <table v-else class="ov-table">
        <thead>
          <tr>
            <th>编号</th>
            <th>开发名称</th>
            <th>模块</th>
            <th>FSD 定稿</th>
            <th class="num">已等待</th>
            <th>开发对象</th>
            <th v-if="data.people.length">指派开发</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="h in dev.handover" :key="h.id" class="link" @click="open(h.id)">
            <td class="code">{{ h.code }}</td>
            <td class="main">{{ h.name }}</td>
            <td>
              <BaseTag :tone="moduleHue(h.module)">{{ h.module }}</BaseTag>
            </td>
            <td>
              <span class="ov-tags"
                >{{ shortDate(h.finalOn) }}
                <BaseTag v-if="h.estimated" tone="neutral">估算</BaseTag></span
              >
            </td>
            <td class="num">{{ h.waitDays }} 天</td>
            <td>
              <span v-if="!h.objects.length" class="ov-muted">未登记</span>
              <span v-else class="ov-tags">
                <BaseTag
                  v-for="o in h.objects"
                  :key="o.objectType + o.objectName"
                  :tone="o.shared.length ? 'yellow' : 'neutral'"
                  :title="
                    o.shared.length
                      ? '也被 ' + o.shared.map((s) => s.code).join('、') + ' 使用'
                      : ''
                  "
                  >{{ o.objectName }}</BaseTag
                >
              </span>
            </td>
            <td v-if="data.people.length" @click.stop>
              <select
                class="assign"
                :aria-label="'指派 ' + h.code + ' 的开发人员'"
                :disabled="assigning === h.id"
                @change="assign(h, ($event.target as HTMLSelectElement).value)"
              >
                <option value="">选择开发人员</option>
                <option v-for="m in data.people" :key="m.id" :value="m.id">{{ m.name }}</option>
              </select>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>

  <div class="ov-cols">
    <section class="ov-section">
      <h2>
        在制品年龄<small
          >进行中或已延误的阶段已持续的天数；虚线为中位数，红线为 P85，空心点为估算</small
        >
      </h2>
      <div class="ov-card aging">
        <div v-for="row in agingRows" :key="row.key" class="age-row">
          <span class="age-label">{{ row.label }}</span>
          <span class="age-track">
            <span
              v-if="row.p50 !== null"
              class="ref"
              :style="{ left: x(row.p50) }"
              :title="'中位数 ' + row.p50 + ' 天'"
            ></span>
            <span
              v-if="row.p85 !== null"
              class="ref p85"
              :style="{ left: x(row.p85) }"
              :title="'P85 ' + row.p85 + ' 天'"
            ></span>
            <button
              v-for="pt in row.points"
              :key="pt.id"
              type="button"
              class="dot"
              :class="{ estimated: pt.estimated }"
              :style="{ left: x(pt.days) }"
              :aria-label="pt.code + ' ' + pt.name + ' ' + pt.days + ' 天'"
              :title="pt.code + ' ' + pt.name + ' · ' + pt.days + ' 天'"
              @click="open(pt.id)"
            ></button>
          </span>
          <span class="age-stat">{{
            row.points.length ? `${row.points.length} 项 · P85 ${row.p85} 天` : '—'
          }}</span>
        </div>
        <p class="ov-note">横轴 0–{{ maxAge }} 天；开始日期取实际开始，没有时取计划开始。</p>
      </div>
    </section>

    <section class="ov-section">
      <h2>开发完成待测<small>按等待天数排序，提醒顾问测试</small></h2>
      <AwaitingTest :rows="dev.awaitingTest" @open="open" />
    </section>
  </div>

  <div class="ov-cols">
    <section class="ov-section">
      <h2>共用对象<small>同一 SAP 对象被多个未交付的开发项修改，需约定主改人与传输顺序</small></h2>
      <div class="ov-card">
        <p v-if="!dev.conflicts.length" class="ov-empty">没有被多个开发项共用的对象。</p>
        <table v-else class="ov-table">
          <thead>
            <tr>
              <th>对象</th>
              <th>开发项</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in dev.conflicts" :key="c.pgmid + c.objectType + c.objectName">
              <td>
                <span class="code">{{ c.objectType }}</span>
                <span class="ov-object">{{ c.objectName }}</span>
              </td>
              <td>
                <span class="ov-tags">
                  <button
                    v-for="i in c.items"
                    :key="i.id"
                    type="button"
                    class="ov-cell-button"
                    @click="open(i.id)"
                  >
                    {{ i.code }} {{ i.name }}
                  </button>
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="ov-section">
      <h2>FSD 定稿率<small>有“定稿”版本的开发项 / 总数</small></h2>
      <div class="ov-card rates">
        <div class="ov-bar">
          <span class="line"
            >全部<strong
              >{{ finalRate.total.final }} / {{ finalRate.total.total }}（{{
                finalRate.total.pct
              }}%）</strong
            ></span
          >
          <span class="track"
            ><span class="fill green" :style="{ width: finalRate.total.pct + '%' }"></span
          ></span>
        </div>
        <div v-for="m in finalRate.modules" :key="m.module" class="ov-bar">
          <span class="line"
            ><BaseTag :tone="moduleHue(m.module)">{{ m.module }}</BaseTag
            ><strong>{{ m.final }} / {{ m.total }}（{{ m.pct }}%）</strong></span
          >
          <span class="track"
            ><span class="fill green" :style="{ width: m.pct + '%' }"></span
          ></span>
        </div>
        <p v-if="dev.reverse.length" class="ov-note">
          另有 {{ dev.reverse.length }} 项开发已开始但 FSD 未定稿：
          <button
            v-for="r in dev.reverse"
            :key="r.id"
            type="button"
            class="ov-cell-button"
            @click="open(r.id)"
          >
            {{ r.code }}
          </button>
        </p>
      </div>
    </section>
  </div>

  <section class="ov-section">
    <h2>
      开发助手覆盖<small
        >开发已开始的开发项中，用过开发助手、有定稿代码、有从 SAP 取回的版本的比例</small
      >
    </h2>
    <div class="ov-card rates">
      <p v-if="!dev.coverage.started" class="ov-empty">还没有开始开发的开发项。</p>
      <template v-else>
        <div v-for="c in coverageRows" :key="c.label" class="ov-bar">
          <span class="line"
            >{{ c.label
            }}<strong
              >{{ c.value }} / {{ dev.coverage.started }}（{{
                pct(c.value, dev.coverage.started)
              }}%）</strong
            ></span
          >
          <span class="track"
            ><span class="fill" :style="{ width: pct(c.value, dev.coverage.started) + '%' }"></span
          ></span>
        </div>
        <p v-if="dev.coverage.missing.length" class="ov-note">
          未用开发助手：
          <button
            type="button"
            class="ov-cell-button"
            @click="drill(ids(dev.coverage.missing), '开发已开始、未用开发助手')"
          >
            {{ dev.coverage.missing.length }} 项
          </button>
        </p>
      </template>
    </div>
  </section>
  <section v-if="data.development.rework.some((r) => r.retest)" class="ov-section">
    <h2>需重测<small>FSD 定稿后又修改，而开发或测试已经开始的开发项</small></h2>
    <div class="ov-card">
      <span class="ov-tags">
        <button
          v-for="r in data.development.rework.filter((x) => x.retest)"
          :key="r.id"
          type="button"
          class="ov-cell-button"
          @click="open(r.id)"
        >
          {{ r.code }} {{ r.name }}（定稿后 {{ r.laterVersions }} 个新版本）
        </button>
      </span>
    </div>
  </section>
</template>
<style scoped>
.rates,
.aging {
  display: grid;
  gap: var(--space-4);
}
.assign {
  height: var(--control-input);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-6);
  background: var(--panel);
  color: var(--text);
  font: inherit;
  font-size: var(--font-12);
}
.age-row {
  display: grid;
  grid-template-columns: 88px 1fr 128px;
  align-items: center;
  gap: var(--space-3);
}
.age-label,
.age-stat {
  color: var(--text-muted);
  font-size: var(--font-12);
}
.age-stat {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.age-track {
  position: relative;
  height: 20px;
  border-bottom: 1px solid var(--border);
}
.ref {
  position: absolute;
  top: 0;
  bottom: 0;
  border-left: 1px dashed var(--border-emphasis);
}
.ref.p85 {
  border-left: 1px solid var(--red-border-3);
}
.dot {
  position: absolute;
  top: 5px;
  width: 10px;
  height: 10px;
  padding: 0;
  border: 2px solid var(--blue-solid-1);
  border-radius: var(--radius-full);
  background: var(--blue-solid-1);
  cursor: pointer;
}
.dot.estimated {
  background: var(--panel);
}
.dot:focus-visible {
  outline: 2px solid var(--focus);
}
</style>
