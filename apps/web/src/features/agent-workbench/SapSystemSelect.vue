<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { Server } from '@lucide/vue';
import SapLoginDialog from '../sap/SapLoginDialog.vue';
import { purposeLabel, type SapSystem } from '../sap/api';
import { useProjectSap } from '../sap/useProjectSap';
import ContextPicker, { type ContextOption } from './ContextPicker.vue';

// Contract 3.4: the SAP system the next message reads. Empty means the agent's default (the
// item's target or default development system for development, the default test system for
// design); the user may pick any project system they may read. The list is fetched again each
// time the picker opens (spec 4.3); a system the user has not logged in to offers “登录”,
// since the agent reads SAP as that user.
const props = defineProps<{ base: string; purpose: 'development' | 'test'; disabled?: boolean }>();
const systemId = defineModel<string>({ required: true });
const projectId = computed(() => props.base.split('/')[2] ?? '');
const sap = useProjectSap(() => projectId.value);
const loading = ref(false);
async function refresh() {
  loading.value = true;
  try {
    await sap.reload(true);
  } finally {
    loading.value = false;
  }
}
onMounted(() => sap.reload());
const systems = computed(() => [...sap.usable('development'), ...sap.usable('test')]);
const fallback = computed(() => sap.defaultOf(props.purpose));
const chosen = computed<SapSystem | null>(() =>
  systemId.value ? (systems.value.find((s) => s.id === systemId.value) ?? null) : fallback.value,
);
const needsLogin = (s: SapSystem | null) => !!s && s.credential?.state === 'none';
const label = (s: SapSystem) => `${s.sid} ${s.client}`;
const value = computed(() =>
  chosen.value
    ? (systemId.value ? '' : '默认 · ') + label(chosen.value)
    : '默认' + purposeLabel(props.purpose) + '（未登记）',
);
const option = (s: SapSystem): ContextOption => ({
  id: s.id,
  label: label(s),
  detail: s.name,
  badge: needsLogin(s) ? '未登录' : undefined,
  warn: needsLogin(s),
});
const groups = computed(() => [
  {
    heading: '默认',
    options: [
      {
        id: '',
        label: fallback.value ? '默认 · ' + label(fallback.value) : '默认（未登记）',
        detail: fallback.value?.name ?? `项目的默认${purposeLabel(props.purpose)}`,
        badge: needsLogin(fallback.value) ? '未登录' : undefined,
        warn: needsLogin(fallback.value),
      },
    ],
  },
  { heading: '开发系统', options: sap.usable('development').map(option) },
  { heading: '测试系统', options: sap.usable('test').map(option) },
]);
const loginFor = ref<SapSystem | null>(null);
const loginOpen = ref(false);
function login(id: string) {
  loginFor.value = systems.value.find((s) => s.id === (id || fallback.value?.id)) ?? null;
  loginOpen.value = !!loginFor.value;
}
</script>
<template>
  <ContextPicker
    label="SAP 系统"
    :icon="Server"
    :value="value"
    :groups="groups"
    :selected-id="systemId"
    :disabled="disabled"
    :loading="loading"
    :warning="needsLogin(chosen) ? `未登录 ${chosen!.name}，助手将无法读取` : ''"
    empty="项目尚未登记可读取的 SAP 系统"
    @open="refresh"
    @select="systemId = $event"
  >
    <template #action="{ option: o }">
      <button
        v-if="o.warn"
        type="button"
        class="sap-login"
        :title="'用你本人的 SAP 用户登录 ' + o.detail"
        @click="login(o.id)"
      >
        登录
      </button>
    </template>
  </ContextPicker>
  <SapLoginDialog
    v-if="sap.view.value && loginFor"
    v-model:open="loginOpen"
    :project-id="projectId"
    :system="loginFor"
    :can-save="sap.view.value.canSave"
    :policy="sap.view.value.policy"
    :profile-login="sap.view.value.profileLogin"
    @saved="sap.adopt"
  />
</template>
<style scoped>
.sap-login {
  flex-shrink: 0;
  height: var(--control-button);
  padding: 0 var(--space-2);
  border: 0;
  border-radius: var(--radius-6);
  background: none;
  font-size: var(--font-12);
  color: var(--link);
  cursor: pointer;
}
.sap-login:hover {
  background: var(--hover);
}
</style>
