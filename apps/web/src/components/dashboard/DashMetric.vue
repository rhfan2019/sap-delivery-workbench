<script setup lang="ts">
import { ArrowDownRight, ArrowRight, ArrowUpRight } from '@lucide/vue';
import './dashboard.css';

// A key number (docs/DESIGN.md 12): label, the number with its unit, a trend badge and one line
// of explanation. With `open` it is a button that drills down to the list the number counts.
export interface Trend {
  text: string;
  direction: 'up' | 'down' | 'flat';
  // Whether the change is good news: an overdue count going up is bad.
  good: boolean | null;
}
const props = defineProps<{
  label: string;
  value: string | number;
  unit?: string;
  sub?: string;
  tone?: '' | 'red' | 'yellow';
  trend?: Trend | null;
  open?: () => void;
}>();
const arrow = { up: ArrowUpRight, down: ArrowDownRight, flat: ArrowRight };
const mood = (t: Trend) => (t.good === null ? 'flat' : t.good ? 'good' : 'bad');
</script>
<template>
  <component
    :is="props.open ? 'button' : 'div'"
    :type="props.open ? 'button' : undefined"
    class="dash-metric dash-rise"
    @click="props.open?.()"
  >
    <span class="label"><slot name="icon" />{{ label }}</span>
    <span class="row">
      <span class="value" :class="tone"
        >{{ value }}<small v-if="unit">{{ unit }}</small></span
      >
      <span v-if="trend" class="dash-trend" :class="mood(trend)"
        ><component :is="arrow[trend.direction]" />{{ trend.text }}</span
      >
    </span>
    <span v-if="sub" class="sub">{{ sub }}</span>
  </component>
</template>
