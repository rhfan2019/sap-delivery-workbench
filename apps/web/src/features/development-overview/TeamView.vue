<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import type { OverviewFilter } from '@sap-delivery-workbench/contracts/delivery/overview';
import BaseAvatar from '../../components/base/BaseAvatar.vue';
import BaseTag from '../../components/base/BaseTag.vue';
import { moduleHue } from '../../components/base/identity';
import { currentProject } from '../../services/projectContext';
import { itemLink, shortDate, type Brief, type Overview } from './model';

// The development team view (spec section 2, development lead): FSD handover in both
// directions, SAP objects shared by open items, developed items waiting for the test, and
// how far the FSDs are finalized.
const props = defineProps<{
  data: Overview;
  drill: (filter: OverviewFilter, label: string) => void;
}>();
const router = useRouter();
const open = (id: string) => void router.push(itemLink(currentProject.value, id));
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
const finalRate = computed(() => {
  const f = dev.value.fsdFinal;
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
  return {
    total: { ...f, pct: pct(f.final, f.total) },
    modules: Object.entries(f.byModule).map(([m, v]) => ({
      module: m,
      ...v,
      pct: pct(v.final, v.total),
    })),
  };
});
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

  <div class="ov-cols">
    <section class="ov-section">
      <h2>
        可派开发<small>按 FSD 定稿后的等待天数排序；定稿日期暂取定稿版本的生成时间（估算）</small>
      </h2>
      <div class="ov-card">
        <p v-if="!dev.handover.length" class="ov-empty">没有等待指派开发的已定稿 FSD。</p>
        <table v-else class="ov-table">
          <thead>
            <tr>
              <th>编号</th>
              <th>开发名称</th>
              <th>模块</th>
              <th>FSD 定稿</th>
              <th class="num">已等待</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="h in dev.handover" :key="h.id" class="link" @click="open(h.id)">
              <td class="code">{{ h.code }}</td>
              <td class="main">{{ h.name }}</td>
              <td>
                <BaseTag :tone="moduleHue(h.module)">{{ h.module }}</BaseTag>
              </td>
              <td>{{ shortDate(h.finalOn) }}</td>
              <td class="num">{{ h.waitDays }} 天</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="ov-section">
      <h2>开发完成待测<small>按等待天数排序，提醒顾问测试</small></h2>
      <div class="ov-card">
        <p v-if="!dev.awaitingTest.length" class="ov-empty">没有等待顾问测试的开发项。</p>
        <table v-else class="ov-table">
          <thead>
            <tr>
              <th>编号</th>
              <th>开发名称</th>
              <th>顾问测试人</th>
              <th class="num">已等待</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="a in dev.awaitingTest" :key="a.id" class="link" @click="open(a.id)">
              <td class="code">{{ a.code }}</td>
              <td class="main">{{ a.name }}</td>
              <td>
                <span v-if="a.tester" class="person"
                  ><BaseAvatar :name="a.tester" :size="20" />{{ a.tester }}</span
                >
                <span v-else class="muted">未分配</span>
              </td>
              <td class="num">{{ a.waitDays === null ? '—' : a.waitDays + ' 天' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
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
                <span class="object">{{ c.objectName }}</span>
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
</template>
<style scoped>
.person {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1-5);
  white-space: nowrap;
}
.muted {
  color: var(--text-subtle);
}
.object {
  margin-left: var(--space-2);
  font-family: var(--font-mono);
  font-size: var(--font-12);
}
.rates {
  display: grid;
  gap: var(--space-4);
}
</style>
