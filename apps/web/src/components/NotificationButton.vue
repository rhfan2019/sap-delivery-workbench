<script setup lang="ts">
import { Bell } from '@lucide/vue';
import BasePopover from './base/BasePopover.vue';
// Notifications at the foot of the icon rail (DESIGN.md 4.1). Reminders and their settings are
// still planned, so the panel says what will appear here; an unread count joins the bell then.
</script>
<template>
  <BasePopover side="right" align="end">
    <template #trigger>
      <button type="button" class="bell" aria-label="通知" title="通知">
        <Bell />
      </button>
    </template>
    <div class="notifications" role="region" aria-label="通知">
      <strong>通知</strong>
      <p>暂无通知。里程碑到期、权限即将到期等提醒上线后会显示在这里。</p>
    </div>
  </BasePopover>
</template>
<style scoped>
.bell {
  display: inline-grid;
  place-items: center;
  width: var(--control-icon);
  height: var(--control-icon);
  padding: 0;
  border: 0;
  border-radius: var(--radius-6);
  background: transparent;
  color: var(--neutral-icon-1);
  cursor: pointer;
  transition: background-color var(--motion-fast);
}
.bell svg {
  width: 18px;
  height: 18px;
}
.bell:hover,
.bell[data-state='open'] {
  background: var(--hover);
  color: var(--text);
}
.bell:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--focus);
}
.notifications {
  display: grid;
  gap: var(--space-2);
  width: 280px;
}
.notifications strong {
  font-size: var(--font-14);
  font-weight: var(--weight-550);
}
.notifications p {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--font-12);
  line-height: var(--leading-16);
}
</style>
