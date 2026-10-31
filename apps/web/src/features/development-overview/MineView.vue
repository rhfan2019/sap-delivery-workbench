<script setup lang="ts">
import { useRouter } from 'vue-router';
import { Sparkles, Code2 } from '@lucide/vue';
import { OPTIONS, PHASES, type PhaseKey } from '@sap-delivery-workbench/contracts/delivery/fields';
import {
  RISK_SOURCES,
  type OverviewFilter,
} from '@sap-delivery-workbench/contracts/delivery/overview';
import BaseButton from '../../components/base/BaseButton.vue';
import BaseTag from '../../components/base/BaseTag.vue';
import { currentProject } from '../../services/projectContext';
import { openFrom, assistantLink, itemLink, shortDate, type Overview } from './model';

// The personal view (spec section 2, developer and subcontractor): what to do first, what waits
// for me, my SAP objects. No personal statistics and no comparison with others.
const props = defineProps<{
  data: Overview;
  drill: (filter: OverviewFilter, label: string) => void;
}>();
const router = useRouter();
const open = (id: string) => void openFrom(router, itemLink(currentProject.value, id));
const assist = (id: string, stage: 'design' | 'development') =>
  void openFrom(router, assistantLink(currentProject.value, id, stage));
const phaseLabel = (key: PhaseKey) => PHASES.find((p) => p.key === key)?.label ?? key;
const statusTone = (status: string) =>
  status === 'in_progress' ? 'blue' : status === 'delayed' ? 'red' : 'neutral';
const all = () => props.drill({ ids: props.data.mine.todoIds }, '我负责的未完成阶段');
</script>
<template>
  <section class="ov-section">
    <h2>
      今天先做<small
        >我负责的未完成阶段，风险在前，再按计划完成日与优先级{{
          data.mine.todoTotal > data.mine.today.length ? `；共 ${data.mine.todoTotal} 项` : ''
        }}</small
      >
    </h2>
    <div class="ov-card">
      <p v-if="!data.mine.today.length" class="ov-empty">你没有负责的未完成阶段。</p>
      <table v-else class="ov-table">
        <thead>
          <tr>
            <th>编号</th>
            <th>开发名称</th>
            <th>阶段</th>
            <th>状态</th>
            <th>计划完成</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="t in data.mine.today" :key="t.id + t.phase" class="link" @click="open(t.id)">
            <td class="code">{{ t.code }}</td>
            <td class="main">{{ t.name }}</td>
            <td>{{ phaseLabel(t.phase) }}</td>
            <td>
              <span class="ov-tags">
                <BaseTag :tone="statusTone(t.status)">{{ OPTIONS.status[t.status] }}</BaseTag>
                <BaseTag v-if="t.risk === 'stale'" tone="red">{{ RISK_SOURCES.stale }}</BaseTag>
              </span>
            </td>
            <td>{{ t.plannedEnd ? shortDate(t.plannedEnd) : '—' }}</td>
            <td class="num">
              <BaseButton
                v-if="t.stage"
                size="sm"
                variant="ghost"
                @click.stop="assist(t.id, t.stage)"
                ><Sparkles v-if="t.stage === 'design'" /><Code2 v-else />{{
                  t.stage === 'design' ? '设计' : '开发'
                }}</BaseButton
              >
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="data.mine.todoTotal > data.mine.today.length" class="ov-note ov-more">
        <button type="button" class="ov-cell-button" @click="all">在开发清单中查看全部</button>
      </p>
    </div>
  </section>

  <div class="ov-cols">
    <section class="ov-section">
      <h2>需要我回应<small>我负责阶段上的未解决批注、近 7 天定稿的 FSD</small></h2>
      <div class="ov-card">
        <p v-if="!data.mine.respond.length" class="ov-empty">没有等你回应的事项。</p>
        <table v-else class="ov-table">
          <tbody>
            <tr
              v-for="(r, index) in data.mine.respond"
              :key="index"
              class="link"
              @click="
                assist(r.id, r.type === 'final' || r.source === 'fsd' ? 'design' : 'development')
              "
            >
              <td class="code">{{ r.code }}</td>
              <td class="main">{{ r.name }}</td>
              <td>
                <BaseTag :tone="r.type === 'final' ? 'green' : 'yellow'">{{
                  r.type === 'final'
                    ? 'FSD 已定稿'
                    : r.source === 'fsd'
                      ? 'FSD 批注待处理'
                      : '代码批注待处理'
                }}</BaseTag>
              </td>
              <td class="num">{{ r.days === 0 ? '今天' : r.days + ' 天前' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="ov-section">
      <h2>我的对象<small>我负责的未完成开发项涉及的 SAP 对象，标出与别人共用的</small></h2>
      <div class="ov-card">
        <p v-if="!data.mine.objects.length" class="ov-empty">还没有登记开发对象。</p>
        <table v-else class="ov-table">
          <tbody>
            <tr v-for="(o, index) in data.mine.objects" :key="index">
              <td>
                <span class="code">{{ o.objectType }}</span>
                <span class="ov-object">{{ o.objectName }}</span>
              </td>
              <td>
                <button type="button" class="ov-cell-button" @click="open(o.item.id)">
                  {{ o.item.code }}
                </button>
              </td>
              <td>
                <span v-if="o.shared.length" class="ov-tags">
                  <BaseTag tone="yellow">共用</BaseTag>
                  <button
                    v-for="s in o.shared"
                    :key="s.id"
                    type="button"
                    class="ov-cell-button"
                    @click="open(s.id)"
                  >
                    {{ s.code }} {{ s.name }}
                  </button>
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>
