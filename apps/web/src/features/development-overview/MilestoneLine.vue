<script setup lang="ts">
import { computed } from 'vue';
import {
  MILESTONE_STATES,
  milestoneState,
} from '@sap-delivery-workbench/contracts/projects/options';
import { daysBetween } from '@sap-delivery-workbench/contracts/delivery/overview';
import BaseTag from '../../components/base/BaseTag.vue';
import { shortDate, type Milestone } from './model';

// The project's dated milestones in order with “today” among them (spec section 2, top row).
const props = defineProps<{ milestones: Milestone[]; today: string }>();
const TONES = { achieved: 'green', delayed: 'red', due: 'yellow', upcoming: 'neutral' } as const;
const stops = computed(() => {
  const dated = props.milestones
    .filter((m) => m.achievedOn || m.plannedOn)
    .map((m) => {
      const date = (m.achievedOn ?? m.plannedOn)!;
      const state = milestoneState(m, props.today) as keyof typeof TONES;
      const days = daysBetween(props.today, date);
      return {
        key: m.key,
        name: m.name,
        date,
        tone: TONES[state],
        state: MILESTONE_STATES[state],
        when:
          state === 'achieved'
            ? ''
            : days === 0
              ? '今天'
              : days > 0
                ? `还有 ${days} 天`
                : `已过 ${-days} 天`,
        past: date < props.today || state === 'achieved',
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
  const at = dated.findIndex((s) => !s.past);
  return { dated, at: at < 0 ? dated.length : at };
});
</script>
<template>
  <section class="ov-section" aria-label="里程碑">
    <p v-if="!stops.dated.length" class="ov-note">
      项目还没有排期的里程碑。在“设置 → 项目 → 计划与健康”中维护开发冻结、SIT、UAT 与上线日期。
    </p>
    <ol v-else class="line">
      <template v-for="(s, index) in stops.dated" :key="s.key">
        <li v-if="index === stops.at" class="today" aria-label="今天">
          <span class="mark"></span><span class="name">今天</span
          ><span class="date">{{ shortDate(today) }}</span>
        </li>
        <li :class="{ past: s.past }">
          <span class="dot" :style="{ background: `var(--${s.tone}-solid-1)` }"></span>
          <span class="name">{{ s.name }}</span>
          <span class="date"
            >{{ shortDate(s.date) }}<template v-if="s.when"> · {{ s.when }}</template></span
          >
          <BaseTag v-if="s.tone !== 'neutral'" :tone="s.tone">{{ s.state }}</BaseTag>
        </li>
      </template>
      <li v-if="stops.at === stops.dated.length" class="today" aria-label="今天">
        <span class="mark"></span><span class="name">今天</span
        ><span class="date">{{ shortDate(today) }}</span>
      </li>
    </ol>
  </section>
</template>
<style scoped>
.line {
  display: flex;
  gap: 0;
  margin: 0;
  padding: 0 0 var(--space-1);
  list-style: none;
  overflow-x: auto;
}
li {
  position: relative;
  display: grid;
  justify-items: start;
  align-content: start;
  gap: var(--space-1);
  flex: 1 0 140px;
  padding: var(--space-5) var(--space-3) 0 0;
  border-top: 2px solid var(--border-strong);
}
li.past {
  border-top-color: var(--neutral-solid-1);
}
.dot,
.mark {
  position: absolute;
  top: -7px;
  left: 0;
  width: 12px;
  height: 12px;
  border-radius: var(--radius-full);
  box-shadow: 0 0 0 2px var(--panel);
}
li.today {
  flex: 0 0 auto;
  padding-right: var(--space-5);
  border-top-color: var(--blue-solid-1);
}
.mark {
  left: -1px;
  width: 2px;
  height: 20px;
  top: -11px;
  border-radius: 0;
  background: var(--blue-solid-1);
  box-shadow: none;
}
.name {
  font-size: var(--font-14);
  line-height: var(--leading-20);
}
li.past .name {
  color: var(--text-muted);
}
li.today .name {
  color: var(--link);
}
.date {
  color: var(--text-muted);
  font-size: var(--font-12);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
</style>
