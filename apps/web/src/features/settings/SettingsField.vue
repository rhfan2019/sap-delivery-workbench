<script setup lang="ts">
// One setting: its name and a short explanation on the left, the control on the right; stacked
// on narrow screens. `for` links the name to an input with that id.
defineProps<{ label: string; help?: string; for?: string; required?: boolean }>();
</script>
<template>
  <div class="settings-field">
    <div class="field-text">
      <label v-if="$props.for" :for="$props.for" class="field-label"
        >{{ label }}<span v-if="required" class="field-required" aria-hidden="true">*</span></label
      >
      <span v-else class="field-label"
        >{{ label }}<span v-if="required" class="field-required" aria-hidden="true">*</span></span
      >
      <p v-if="help" class="field-help">{{ help }}</p>
    </div>
    <div class="field-control"><slot /></div>
  </div>
</template>
<style scoped>
.settings-field {
  display: grid;
  grid-template-columns: minmax(0, 220px) minmax(0, 1fr);
  gap: var(--space-4);
  align-items: start;
}
.field-text {
  padding-top: var(--space-1-5);
}
.field-label {
  font-weight: var(--weight-475);
}
.field-required {
  margin-left: var(--space-0-5);
  color: var(--red-text-2);
}
.field-help {
  margin: var(--space-0-5) 0 0;
  color: var(--text-muted);
  font-size: var(--font-12);
  line-height: var(--leading-16);
}
.field-control {
  display: grid;
  gap: var(--space-2);
  min-width: 0;
}
@media (max-width: 760px) {
  .settings-field {
    grid-template-columns: 1fr;
    gap: var(--space-1-5);
  }
  .field-text {
    padding-top: 0;
  }
}
</style>
