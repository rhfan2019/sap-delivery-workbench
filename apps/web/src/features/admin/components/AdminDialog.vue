<script setup lang="ts">
import { onMounted, ref } from 'vue';
import AppIcon from '../../../components/AppIcon.vue';
withDefaults(
  defineProps<{
    title: string;
    busy?: boolean;
    error?: string;
    submitLabel?: string;
    hideCancel?: boolean;
  }>(),
  { submitLabel: '保存' },
);
const emit = defineEmits<{ close: []; submit: [] }>();
const dialog = ref<HTMLDialogElement | null>(null);
onMounted(() => dialog.value?.showModal());
</script>
<template>
  <dialog
    ref="dialog"
    class="admin-dialog"
    aria-labelledby="admin-dialog-title"
    @cancel.prevent="!busy && emit('close')"
  >
    <form @submit.prevent="emit('submit')">
      <header>
        <div>
          <h2 id="admin-dialog-title">{{ title }}</h2>
        </div>
        <button
          type="button"
          class="icon-button"
          aria-label="关闭弹窗"
          :disabled="busy"
          @click="emit('close')"
        >
          <AppIcon name="x" />
        </button>
      </header>
      <div class="dialog-body">
        <slot />
        <p v-if="error" class="error-note" role="alert">{{ error }}</p>
      </div>
      <footer>
        <button
          v-if="!hideCancel"
          type="button"
          class="secondary-button"
          :disabled="busy"
          @click="emit('close')"
        >
          取消</button
        ><button class="primary-button" :disabled="busy">
          {{ busy ? '正在保存…' : submitLabel }}
        </button>
      </footer>
    </form>
  </dialog>
</template>
