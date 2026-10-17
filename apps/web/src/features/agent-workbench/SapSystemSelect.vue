<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '../../services/session';

// Contract 1.12: the SAP system the next message reads (DEV or QAS), from the project's
// effective parameters. Until projects configure defaults, the user chooses freely.
const props = defineProps<{ base: string; disabled?: boolean }>();
const environment = defineModel<'DEV' | 'QAS'>({ required: true });
interface Effective {
  environment: string;
  systemName: string | null;
  client: string | null;
  available: boolean;
  credentialReady: boolean;
}
const effective = ref<Effective[]>([]);
const projectId = computed(() => props.base.split('/')[2]);
onMounted(async () => {
  try {
    effective.value = (
      await api<{ effective: Effective[] }>(`/projects/${projectId.value}/sap`)
    ).effective;
  } catch {}
});
const options = computed(() =>
  (['DEV', 'QAS'] as const).map((value) => {
    const e = effective.value.find((x) => x.environment === value);
    const ready = !!e?.available && !!e.credentialReady;
    return {
      value,
      ready,
      // The full name is the tooltip; the composer only has room for DEV / QAS.
      title: e?.systemName ? `${value} · ${e.systemName}${e.client ? ' ' + e.client : ''}` : value,
    };
  }),
);
</script>
<template>
  <select
    v-model="environment"
    class="max-w-56 shrink-0 truncate rounded-md bg-transparent px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
    aria-label="选择 SAP 系统"
    :title="
      '本条消息读取的 SAP 系统：' +
      (options.find((o) => o.value === environment)?.title ?? environment)
    "
    :disabled="disabled"
  >
    <option v-for="o in options" :key="o.value" :value="o.value">
      {{ o.value }}{{ o.ready || !effective.length ? '' : '（未配置）' }}
    </option>
  </select>
</template>
