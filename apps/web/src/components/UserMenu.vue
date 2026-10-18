<script setup lang="ts">
import { useRouter } from 'vue-router';
import { Keyboard, LogOut, Settings } from '@lucide/vue';
import BaseAvatar from './base/BaseAvatar.vue';
import BaseMenu from './base/BaseMenu.vue';
import BaseMenuItem from './base/BaseMenuItem.vue';
import BaseMenuSeparator from './base/BaseMenuSeparator.vue';
import { identity } from '../services/session';
// The account menu at the foot of the icon rail.
defineProps<{ busy: boolean }>();
const emit = defineEmits<{ logout: []; shortcuts: [] }>();
const router = useRouter();
</script>
<template>
  <BaseMenu side="right" align="end">
    <template #trigger>
      <button type="button" class="account" aria-label="账户菜单">
        <BaseAvatar :name="identity?.user.displayName ?? '?'" :size="24" />
      </button>
    </template>
    <div class="profile">
      <BaseAvatar :name="identity?.user.displayName ?? '?'" :size="32" />
      <div>
        <strong>{{ identity?.user.displayName }}</strong>
        <span>{{ identity?.user.loginName }} · {{ identity?.organization.name }}</span>
      </div>
    </div>
    <BaseMenuSeparator />
    <BaseMenuItem @select="router.push('/settings/profile')"
      ><template #icon><Settings /></template>个人设置</BaseMenuItem
    >
    <BaseMenuItem kbd="?" @select="emit('shortcuts')"
      ><template #icon><Keyboard /></template>键盘快捷键</BaseMenuItem
    >
    <BaseMenuSeparator />
    <BaseMenuItem :disabled="busy" @select="emit('logout')"
      ><template #icon><LogOut /></template>{{ busy ? '正在退出…' : '退出登录' }}</BaseMenuItem
    >
  </BaseMenu>
</template>
<style scoped>
.account {
  display: inline-grid;
  place-items: center;
  width: var(--control-icon);
  height: var(--control-icon);
  padding: 0;
  border: 0;
  border-radius: var(--radius-6);
  background: transparent;
  cursor: pointer;
  transition: background-color var(--motion-fast);
}
.account:hover,
.account[data-state='open'] {
  background: var(--hover);
}
.account:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--focus);
}
.profile {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-width: 240px;
  padding: var(--space-2) var(--space-3);
}
.profile strong {
  display: block;
  font-size: var(--font-14);
  font-weight: var(--weight-550);
}
.profile span {
  color: var(--text-muted);
  font-size: var(--font-12);
}
</style>
