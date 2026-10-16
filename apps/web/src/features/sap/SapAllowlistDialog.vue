<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../../services/session';
import AdminDialog from '../admin/components/AdminDialog.vue';
import type { AllowlistEntry, SapSystem } from './types';

// Contract 3.4: function modules and classes that authorized test data creation may call.
const props = defineProps<{ system: SapSystem }>();
defineEmits<{ close: [] }>();
const entries = ref<AllowlistEntry[]>([]),
  draft = ref({ kind: 'BAPI', name: '', description: '' }),
  busy = ref(false),
  error = ref('');
const path = () => '/admin/sap-systems/' + props.system.id + '/allowlist';
async function run(operation: () => Promise<unknown>) {
  busy.value = true;
  error.value = '';
  try {
    await operation();
    entries.value = await api<AllowlistEntry[]>(path());
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
const add = () =>
  run(async () => {
    await api(path(), draft.value);
    draft.value = { kind: draft.value.kind, name: '', description: '' };
  });
const toggle = (entry: AllowlistEntry) =>
  run(() => api(path(), { ...entry, active: !entry.active }));
onMounted(() => run(async () => {}));
</script>
<template>
  <AdminDialog
    :title="system.name + ' · 白名单'"
    :busy="busy"
    :error="error"
    submit-label="加入白名单"
    @close="$emit('close')"
    @submit="add"
  >
    <p class="help-note">
      设计助手为测试案例在 QAS 建单时，生成的代码只能调用这里启用的 BAPI、函数模块和类；
      提交请同时加入 BAPI_TRANSACTION_COMMIT。
    </p>
    <ul class="sap-grant-list">
      <li v-for="e in entries" :key="e.id">
        <span
          ><strong>{{ e.name }}</strong> · {{ e.kind }} · {{ e.active ? '启用' : '已停用'
          }}<br /><small>{{ e.description }}</small></span
        ><button type="button" class="text-button" :disabled="busy" @click="toggle(e)">
          {{ e.active ? '停用' : '启用' }}
        </button>
      </li>
    </ul>
    <p v-if="!entries.length && !busy" class="help-note">白名单为空：不允许建单。</p>
    <div class="field-grid">
      <div>
        <label for="allow-kind">类型</label
        ><select id="allow-kind" v-model="draft.kind">
          <option value="BAPI">BAPI</option>
          <option value="FM">函数模块</option>
          <option value="CLASS">类</option>
        </select>
      </div>
      <div>
        <label for="allow-name">名称</label
        ><input
          id="allow-name"
          v-model="draft.name"
          required
          maxlength="40"
          placeholder="BAPI_SALESORDER_CREATEFROMDAT2"
        />
      </div>
    </div>
    <label for="allow-desc">说明</label
    ><input id="allow-desc" v-model="draft.description" maxlength="200" />
  </AdminDialog>
</template>
