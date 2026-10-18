<script setup lang="ts">
import BaseButton from '../../components/base/BaseButton.vue';
// A settings card (after Plain): a title and one sentence, the fields, and a footer whose Save
// button saves only this card. Without `editable` the card is read-only and has no footer.
withDefaults(
  defineProps<{
    title?: string;
    description?: string;
    editable?: boolean;
    saving?: boolean;
    dirty?: boolean;
    error?: string;
    saveLabel?: string;
    flush?: boolean;
  }>(),
  { editable: false, saving: false, dirty: true, saveLabel: '保存' },
);
const emit = defineEmits<{ save: [] }>();
</script>
<template>
  <section class="settings-card" :class="{ flush }">
    <header v-if="title || $slots.headerActions" class="card-head">
      <div>
        <h2 v-if="title">{{ title }}</h2>
        <p v-if="description">{{ description }}</p>
      </div>
      <div v-if="$slots.headerActions" class="card-head-actions"><slot name="headerActions" /></div>
    </header>
    <div class="card-body"><slot /></div>
    <footer v-if="editable || $slots.footer" class="card-foot">
      <p v-if="error" class="card-error" role="alert">{{ error }}</p>
      <span class="card-foot-note"><slot name="footer" /></span>
      <BaseButton
        v-if="editable"
        variant="primary"
        size="sm"
        :loading="saving"
        :disabled="saving || !dirty"
        @click="emit('save')"
        >{{ saving ? '正在保存…' : saveLabel }}</BaseButton
      >
    </footer>
  </section>
</template>
<style scoped>
.settings-card {
  border: 1px solid var(--border);
  border-radius: var(--radius-12);
  background: var(--panel);
  box-shadow: var(--shadow-card);
  overflow: hidden;
}
.card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-4) var(--space-4) 0;
}
.card-head h2 {
  margin: 0;
  font-size: var(--font-14);
  font-weight: var(--weight-550);
}
.card-head p {
  margin: var(--space-0-5) 0 0;
  color: var(--text-muted);
  font-size: var(--font-12);
  line-height: var(--leading-16);
}
.card-head-actions {
  display: flex;
  gap: var(--space-2);
}
.card-body {
  display: grid;
  gap: var(--space-4);
  padding: var(--space-4);
}
.flush .card-body {
  padding: var(--space-2) 0 0;
  gap: 0;
}
.card-foot {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2-5) var(--space-4);
  border-top: 1px solid var(--border);
  background: var(--neutral-bg-2);
}
.card-foot-note {
  flex: 1;
  color: var(--text-muted);
  font-size: var(--font-12);
}
.card-error {
  margin: 0;
  color: var(--red-text-2);
  font-size: var(--font-12);
}
</style>
