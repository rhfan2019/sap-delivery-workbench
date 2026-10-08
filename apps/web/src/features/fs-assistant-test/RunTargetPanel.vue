<script setup lang="ts">
import { useRoute } from 'vue-router';
import { computed, onMounted, ref, watch } from 'vue';
import { api, type Project } from '../../services/session';
import { currentProject } from '../../services/projectContext';
import type {
  AgentSelection,
  SystemProfile,
  RunReceipt,
} from '@sap-delivery-workbench/contracts/agent-runtime/types';
const route = useRoute();
const props = defineProps<{ busy: boolean; locked: boolean; receipt: RunReceipt | null }>();
type SapSystem = { id: string; name: string; status: string; backendVersion?: string | null };
type ConfigView = {
  systems: SapSystem[];
  defaults: { environment: string; systemId: string | null }[];
};
const projects = ref<Project[]>([]),
  systems = ref<SapSystem[]>([]),
  items = ref<{ id: string; code: string; name: string; rowVersion: string }[]>([]);
const projectId = ref(''),
  itemId = ref(''),
  systemId = ref(''),
  qasSystemId = ref('');
const error = ref(''),
  loading = ref(false),
  identifying = ref(false),
  profiles = ref<Partial<Record<'DEV' | 'QAS', SystemProfile>>>({});
let loadEpoch = 0,
  profileEpoch = 0;
const selection = computed<AgentSelection>(() => ({
  projectId: projectId.value || null,
  itemId: itemId.value || null,
  itemRowVersion: items.value.find((i) => i.id === itemId.value)?.rowVersion ?? null,
  systemId: systemId.value || null,
  qasSystemId: qasSystemId.value || null,
  environment: 'DEV',
}));
const disabled = computed(() => props.busy || props.locked || loading.value);
async function identify() {
  const token = ++profileEpoch;
  if (!projectId.value) return;
  identifying.value = true;
  try {
    const result = await api<Record<'DEV' | 'QAS', SystemProfile>>(
      '/admin/abap-fsd-agent/system-profiles',
      selection.value,
      'POST',
    );
    if (token === profileEpoch) profiles.value = result;
  } catch (e) {
    if (token === profileEpoch) error.value = e instanceof Error ? e.message : '系统识别失败';
  } finally {
    if (token === profileEpoch) identifying.value = false;
  }
}
async function loadItems(id: string) {
  const token = ++loadEpoch;
  profileEpoch++;
  identifying.value = false;
  itemId.value = '';
  items.value = [];
  systems.value = [];
  systemId.value = '';
  qasSystemId.value = '';
  profiles.value = {};
  error.value = '';
  if (!id) {
    loading.value = false;
    return;
  }
  loading.value = true;
  try {
    const [r, c] = await Promise.all([
      api<{ items: typeof items.value }>('/projects/' + id + '/development-items'),
      api<ConfigView>('/projects/' + id + '/sap'),
    ]);
    if (token !== loadEpoch) return;
    items.value = r.items;
    systems.value = c.systems.filter((s) => s.status === 'active');
    systemId.value = c.defaults.find((r) => r.environment === 'DEV')?.systemId ?? '';
    qasSystemId.value = c.defaults.find((r) => r.environment === 'QAS')?.systemId ?? '';
    if (route.query.project === id && r.items.some((i) => i.id === route.query.item))
      itemId.value = String(route.query.item);
  } catch (e) {
    if (token === loadEpoch) error.value = e instanceof Error ? e.message : '项目目标加载失败';
  } finally {
    if (token === loadEpoch) {
      loading.value = false;
      void identify();
    }
  }
}
async function load() {
  loading.value = true;
  error.value = '';
  try {
    projects.value = (await api<Project[]>('/projects')).filter((p) => p.status !== 'archived');
    const id = String(route.query.project || currentProject.value || '');
    if (projects.value.some((p) => p.id === id)) {
      if (projectId.value === id) await loadItems(id);
      else projectId.value = id;
    } else if (projectId.value) await loadItems(projectId.value);
  } catch (e) {
    error.value = e instanceof Error ? e.message : '目标加载失败';
  } finally {
    loading.value = false;
  }
}
function targetChanged() {
  profiles.value = {};
  error.value = '';
  void identify();
}
function versionFor(role: 'DEV' | 'QAS', id: string) {
  const p = profiles.value[role];
  return (
    p?.profile.productVersion ||
    systems.value.find((s) => s.id === id)?.backendVersion ||
    (p?.profile.abapRelease
      ? 'ABAP ' + p.profile.abapRelease
      : identifying.value
        ? '正在自动识别版本…'
        : '版本尚未取得')
  );
}
watch(projectId, loadItems);
watch(currentProject, (id) => {
  if (!props.busy && !props.locked && projects.value.some((p) => p.id === id)) projectId.value = id;
});
watch(
  () => props.receipt,
  (r) => {
    if (r?.systemTargets)
      profiles.value = { DEV: r.systemTargets.DEV.profile, QAS: r.systemTargets.QAS.profile };
    else if (r?.systemProfile) profiles.value.DEV = r.systemProfile;
  },
);
defineExpose({ selection, working: computed(() => loading.value || identifying.value) });
onMounted(load);
</script>
<template>
  <details class="target-panel" open>
    <summary>
      运行目标 · {{ projects.find((p) => p.id === projectId)?.name || '请选择项目' }} · DEV / QAS
    </summary>
    <p class="target-note">
      自动带入项目SAP配置；目标修改仅用于本次对话。已有对话时，请新建对话后再修改。
    </p>
    <div class="target-fields">
      <label
        >关联项目<select aria-label="关联项目" v-model="projectId" :disabled="disabled">
          <option value="">请选择项目</option>
          <option v-for="p in projects" :key="p.id" :value="p.id">
            {{ p.code }} · {{ p.name }}
          </option>
        </select></label
      >
      <label
        >关联开发项<select
          aria-label="关联开发项"
          v-model="itemId"
          :disabled="disabled || !projectId"
        >
          <option value="">不关联开发项</option>
          <option v-for="i in items" :key="i.id" :value="i.id">{{ i.code }} · {{ i.name }}</option>
        </select></label
      >
      <label
        >DEV · 字典与元数据<select
          aria-label="DEV SAP系统"
          v-model="systemId"
          :disabled="disabled || !projectId"
          @change="targetChanged"
        >
          <option value="">项目未配置DEV系统</option>
          <option v-for="s in systems" :key="s.id" :value="s.id">{{ s.name }}</option></select
        ><span class="target-note">{{ versionFor('DEV', systemId) }}</span></label
      >
      <label
        >QAS · 业务数据与测试案例<select
          aria-label="QAS SAP系统"
          v-model="qasSystemId"
          :disabled="disabled || !projectId"
          @change="targetChanged"
        >
          <option value="">项目未配置QAS系统</option>
          <option v-for="s in systems" :key="s.id" :value="s.id">{{ s.name }}</option></select
        ><span class="target-note">{{ versionFor('QAS', qasSystemId) }}</span></label
      >
    </div>
    <p v-if="profiles.DEV?.reason" class="profile-result">DEV：{{ profiles.DEV.reason }}</p>
    <p v-if="profiles.QAS?.reason" class="profile-result">QAS：{{ profiles.QAS.reason }}</p>
    <button type="button" :disabled="disabled || identifying || !projectId" @click="identify">
      {{ identifying ? '正在识别…' : '重新识别版本' }}
    </button>
    <button
      type="button"
      :disabled="disabled || identifying || !projectId"
      @click="loadItems(projectId)"
    >
      重新带入项目配置
    </button>
    <button v-if="error" type="button" :disabled="busy || locked || loading" @click="load">
      重新加载目标
    </button>
    <p v-if="error" role="alert">{{ error }}</p>
  </details>
</template>
<style scoped>
.target-panel {
  margin: 0 20px 8px;
  padding: 8px 12px;
  border: 1px solid #dde5ef;
  border-radius: 10px;
  background: #fff;
  font-size: 13px;
}
.target-panel summary {
  cursor: pointer;
  min-height: 28px;
  overflow-wrap: anywhere;
}
.target-note {
  color: #52667c;
  line-height: 1.5;
}
.target-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
.target-panel label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.target-panel select,
.target-panel input {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  min-height: 36px;
  border: 1px solid #d7e1ee;
  border-radius: 6px;
  background: #fff;
  padding: 6px;
}
.version-input {
  margin: 10px 0;
}
.target-panel button {
  min-height: 44px;
  padding: 6px 10px;
  border: 1px solid #d7e1ee;
  border-radius: 6px;
  background: #f6f9fe;
  color: #245fa0;
}
.profile-result {
  overflow-wrap: anywhere;
  line-height: 1.6;
}
.target-panel :focus-visible {
  outline: 2px solid #437cc4;
}
@media (max-width: 640px) {
  .target-panel {
    margin: 0 12px 8px;
  }
  .target-fields {
    grid-template-columns: 1fr;
  }
}
</style>
