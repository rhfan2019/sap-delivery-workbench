<script setup lang="ts">
import { computed, ref } from 'vue';
import { Sparkle } from '@lucide/vue';
import { api } from '../../services/session';
import ContextPicker from './ContextPicker.vue';

// The model the next message runs on (docs/specs/agent-workspace-start-and-composer.md 4.3):
// the organization's models, default first, fetched each time the picker opens. Empty means
// the organization default.
interface AgentModel {
  id: string;
  name: string;
  provider: string | null;
  isDefault: boolean;
}
const props = defineProps<{ base: string; defaultName: string | null; disabled?: boolean }>();
const modelId = defineModel<string>({ required: true });
const models = ref<AgentModel[]>([]);
const loading = ref(false);
const error = ref('');
async function refresh() {
  loading.value = true;
  error.value = '';
  try {
    models.value = await api<AgentModel[]>(props.base + '/models');
    // A remembered model the organization removed falls back to the default.
    if (modelId.value && !models.value.some((m) => m.id === modelId.value)) modelId.value = '';
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
const picked = computed(() => models.value.find((m) => m.id === modelId.value));
const value = computed(
  () => picked.value?.name ?? (modelId.value ? '已选模型' : (props.defaultName ?? '未配置模型')),
);
const groups = computed(() => [
  {
    heading: '可用模型',
    options: models.value.map((m) => ({
      id: m.isDefault ? '' : m.id,
      label: m.name,
      detail: m.provider ?? undefined,
      badge: m.isDefault ? '默认' : undefined,
    })),
  },
]);
</script>
<template>
  <ContextPicker
    collapsible
    label="模型"
    :icon="Sparkle"
    :value="value"
    :groups="groups"
    :selected-id="modelId"
    :disabled="disabled"
    :loading="loading"
    :empty="error || '组织尚未接入模型'"
    @open="refresh"
    @select="modelId = $event"
  />
</template>
