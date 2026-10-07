<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import AppIcon from './AppIcon.vue';
import { identity } from '../services/session';
defineProps<{ busy: boolean }>();
const emit = defineEmits<{ logout: [] }>();
const route = useRoute();
const open = ref(false);
const root = ref<HTMLElement>();
const trigger = ref<HTMLButtonElement>();
function close(restoreFocus = true) {
  if (!open.value) return;
  open.value = false;
  if (restoreFocus) trigger.value?.focus();
}
async function show(last = false) {
  open.value = true;
  await nextTick();
  const items = root.value?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)');
  items?.[last ? items.length - 1 : 0]?.focus();
}
function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault();
    close();
    return;
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const items = Array.from(
    root.value?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? [],
  );
  const current = items.indexOf(document.activeElement as HTMLElement);
  const index =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? items.length - 1
        : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
  items[index]?.focus();
}
function outside(event: PointerEvent) {
  if (!root.value?.contains(event.target as Node)) close(false);
}
function focusout(event: FocusEvent) {
  if (!root.value?.contains(event.relatedTarget as Node | null)) close(false);
}
watch(
  () => route.fullPath,
  () => close(),
);
onMounted(() => document.addEventListener('pointerdown', outside));
onUnmounted(() => document.removeEventListener('pointerdown', outside));
</script>
<template>
  <div ref="root" class="user-menu" @focusout="focusout">
    <button
      ref="trigger"
      class="avatar avatar-small user-menu-trigger"
      aria-label="账户菜单"
      aria-haspopup="menu"
      aria-controls="account-menu"
      :aria-expanded="open"
      @click="open ? close() : show()"
      @keydown.down.prevent="show()"
      @keydown.up.prevent="show(true)"
      @keydown.esc.prevent="close()"
    >
      {{ identity?.user.displayName.slice(0, 1) }}
    </button>
    <div v-if="open" class="user-menu-panel">
      <div class="user-menu-profile">
        <span class="avatar">{{ identity?.user.displayName.slice(0, 1) }}</span>
        <strong>{{ identity?.user.displayName }}</strong>
        <span>{{ identity?.user.loginName }}</span>
        <span>{{ identity?.organization.name }}</span>
      </div>
      <div id="account-menu" role="menu" aria-label="账户操作" @keydown="keydown">
        <RouterLink to="/settings" role="menuitem" class="user-menu-item" @click="close()"
          ><AppIcon name="settings" :size="17" />个人设置</RouterLink
        >
        <button
          role="menuitem"
          class="user-menu-item"
          :disabled="busy"
          @click="
            close();
            emit('logout');
          "
        >
          <AppIcon name="logout" :size="17" />{{ busy ? '正在退出…' : '退出登录' }}
        </button>
      </div>
    </div>
  </div>
</template>
