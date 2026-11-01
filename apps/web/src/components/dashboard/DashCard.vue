<script setup lang="ts">
import './dashboard.css';

// One card of a dashboard (docs/DESIGN.md 12): a heading with an optional action on the right,
// then the content. `hero` fills it with the brand blue (one per page), `ink` with the dark
// summary colour.
defineProps<{ title?: string; hint?: string; tone?: 'hero' | 'ink'; span?: number }>();
</script>
<template>
  <section class="dash-card" :class="[tone, span ? 'span-' + span : '']" :aria-label="title">
    <header v-if="title || $slots.action" class="dash-card-head">
      <h2>
        <slot name="icon" />{{ title }}<small v-if="hint">{{ hint }}</small>
      </h2>
      <slot name="action" />
    </header>
    <slot />
  </section>
</template>
