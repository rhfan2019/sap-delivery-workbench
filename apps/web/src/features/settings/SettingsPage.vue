<script setup lang="ts">
import AppIcon from '../../components/AppIcon.vue';
// A settings page (docs/specs/project-access-admin.md 4.4, after Plain): an optional back link,
// a 24px title with one sentence, actions on the right; then the content. Detail and form pages
// keep a readable column; list pages may use the panel's full width. A list of records edited in
// a drawer (`list`, DESIGN.md 6.2) is as wide as 大模型 and makes room while the drawer is open.
withDefaults(
  defineProps<{
    title: string;
    description?: string;
    back?: { to: string; label: string };
    wide?: boolean;
    list?: boolean;
    drawer?: boolean;
  }>(),
  { wide: false, list: false, drawer: false },
);
</script>
<template>
  <div class="settings-page" :class="{ wide, list, drawer }">
    <RouterLink v-if="back" :to="back.to" class="settings-back"
      ><AppIcon name="back" :size="14" />{{ back.label }}</RouterLink
    >
    <header class="settings-head">
      <div class="settings-head-text">
        <h1>{{ title }}</h1>
        <p v-if="description">{{ description }}</p>
      </div>
      <div v-if="$slots.actions" class="settings-head-actions"><slot name="actions" /></div>
    </header>
    <slot />
  </div>
</template>
<style scoped>
.settings-page {
  display: grid;
  gap: var(--space-4);
  align-content: start;
  width: 100%;
  max-width: 760px;
  margin: 0 auto;
  padding: var(--space-6) var(--space-2) var(--space-12);
}
.settings-page.wide {
  max-width: 1120px;
}
.settings-page.list {
  max-width: 1600px;
  padding-top: 0;
}
/* The spacing of 大模型: 24 above the summary and the toolbar, 20 above the table. */
.settings-page.list > :deep(.s-summary),
.settings-page.list > :deep(.s-table-toolbar) {
  margin-top: var(--space-2);
}
.settings-page.list > :deep(.s-table-surface) {
  margin-top: var(--space-1);
}
@media (min-width: 1500px) {
  .settings-page.drawer {
    padding-right: calc(var(--space-2) + var(--layout-drawer));
  }
}
:global(.shell-body:has(.settings-page.list)) {
  overflow-anchor: none;
}
.settings-back {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  justify-self: start;
  color: var(--text-muted);
  font-size: var(--font-12);
  text-decoration: none;
  transition: color var(--motion-fast);
}
.settings-back:hover {
  color: var(--text);
}
.settings-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-4);
}
.settings-head h1 {
  margin: 0;
  font-size: var(--font-24);
  line-height: var(--leading-32);
  font-weight: var(--weight-400);
}
.settings-head p {
  margin: var(--space-1) 0 0;
  color: var(--text-muted);
}
.settings-head-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  justify-content: flex-end;
}
@media (max-width: 760px) {
  .settings-page {
    padding: var(--space-4) var(--space-1) var(--space-8);
  }
  .settings-head {
    flex-direction: column;
  }
}
</style>
