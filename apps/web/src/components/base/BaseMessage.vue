<script setup lang="ts">
import BaseAvatar from './BaseAvatar.vue';
// A message block of a timeline (DESIGN.md 5): the avatar sits outside on the left; a user's
// message is light grey, an internal note light yellow.
withDefaults(
  defineProps<{ author: string; time?: string; tone?: 'message' | 'note'; avatar?: boolean }>(),
  { tone: 'message', avatar: true },
);
</script>
<template>
  <article class="base-message" :class="tone">
    <BaseAvatar v-if="avatar" class="avatar" :name="author" :size="32" />
    <div class="block">
      <header>
        <slot name="badge" /><strong>{{ author }}</strong
        ><span v-if="time" class="time">{{ time }}</span
        ><span v-if="$slots.actions" class="actions"><slot name="actions" /></span>
      </header>
      <div class="body"><slot /></div>
      <footer v-if="$slots.footer"><slot name="footer" /></footer>
    </div>
  </article>
</template>
<style scoped>
.base-message {
  display: grid;
  grid-template-columns: 32px 1fr;
  gap: var(--space-3);
  align-items: start;
}
.base-message:not(:has(.avatar)) {
  grid-template-columns: 1fr;
}
.block {
  min-width: 0;
  padding: var(--space-3) var(--space-4) var(--space-4);
  border-radius: var(--radius-8);
  background: var(--neutral-bg-2);
}
.note .block {
  background: var(--yellow-bg-2);
}
header {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-1-5);
  font-size: var(--font-14);
}
strong {
  font-weight: var(--weight-550);
}
.time {
  color: var(--text-muted);
  font-size: var(--font-12);
}
.note .time,
.note header {
  color: var(--yellow-text-2);
}
.note strong {
  color: var(--text);
}
.actions {
  margin-left: auto;
  opacity: 0;
  transition: opacity var(--motion-fast);
}
.base-message:hover .actions,
.actions:focus-within {
  opacity: 1;
}
.body {
  font-size: var(--font-14);
  line-height: var(--leading-20);
}
.body :deep(p) {
  margin: 0 0 var(--space-2);
}
.body :deep(p:last-child) {
  margin-bottom: 0;
}
footer {
  margin-top: var(--space-2);
  color: var(--yellow-text-2);
  font-size: var(--font-12);
}
</style>
