<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import SapLoginDialog from '../sap/SapLoginDialog.vue';
import { purposeLabel, type SapSystem } from '../sap/api';
import { useProjectSap } from '../sap/useProjectSap';

// Contract 3.4: the SAP system the next message reads. Empty means the agent's default (the
// item's target or default development system for development, the default test system for
// design); the user may pick any project system they may read. A system the user has not
// logged in to offers “登录” next to the picker, since the agent reads SAP as that user.
const props = defineProps<{ base: string; purpose: 'development' | 'test'; disabled?: boolean }>();
const systemId = defineModel<string>({ required: true });
const projectId = computed(() => props.base.split('/')[2] ?? '');
const sap = useProjectSap(() => projectId.value);
onMounted(() => sap.reload());
const systems = computed(() => [...sap.usable('development'), ...sap.usable('test')]);
const fallback = computed(() => sap.defaultOf(props.purpose));
const chosen = computed<SapSystem | null>(() =>
  systemId.value ? (systems.value.find((s) => s.id === systemId.value) ?? null) : fallback.value,
);
const needsLogin = computed(() => !!chosen.value && chosen.value.credential?.state === 'none');
const label = (s: SapSystem) => `${s.sid} ${s.client}`;
const loginOpen = ref(false);
</script>
<template>
  <span class="sap-pick">
    <select
      v-model="systemId"
      class="max-w-56 shrink-0 truncate rounded-md bg-transparent px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
      aria-label="选择 SAP 系统"
      :title="
        '本条消息读取的 SAP 系统：' +
        (chosen
          ? `${chosen.name}（${purposeLabel(chosen.purpose)} · ${chosen.sid} client ${chosen.client}）`
          : '项目尚未登记')
      "
      :disabled="disabled"
    >
      <option value="">
        {{ fallback ? '默认 · ' + label(fallback) : '默认' + purposeLabel(purpose) + '（未登记）' }}
      </option>
      <option v-for="s in systems" :key="s.id" :value="s.id">
        {{ label(s) }} · {{ purposeLabel(s.purpose)
        }}{{ s.credential?.state === 'none' ? '（未登录）' : '' }}
      </option>
    </select>
    <button
      v-if="needsLogin && !disabled"
      type="button"
      class="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
      :title="'用你本人的 SAP 用户登录 ' + chosen?.name"
      @click="loginOpen = true"
    >
      登录
    </button>
    <SapLoginDialog
      v-if="sap.view.value && chosen"
      v-model:open="loginOpen"
      :project-id="projectId"
      :system="chosen"
      :can-save="sap.view.value.canSave"
      :policy="sap.view.value.policy"
      :profile-login="sap.view.value.profileLogin"
      @saved="sap.adopt"
    />
  </span>
</template>
<style scoped>
.sap-pick {
  display: inline-flex;
  align-items: center;
  gap: var(--space-0-5);
  min-width: 0;
}
</style>
