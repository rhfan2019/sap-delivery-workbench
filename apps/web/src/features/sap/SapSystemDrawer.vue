<script setup lang="ts">
import { computed, ref } from 'vue';
import SettingsDrawer from '../settings/SettingsDrawer.vue';
import { useSave } from '../settings/useLoad';
import { sapApi, type ProjectSystems, type SapSystem } from './api';

// A project's SAP system in the list's drawer (docs/specs/project-access-admin.md 3.2, 4.4;
// DESIGN.md 5 “抽屉”): an address and a client, never a user or a password. A registered system
// opens to read unless its 编辑 was clicked (development-discipline.md 4.1).
const props = defineProps<{
  projectId: string;
  system: SapSystem | null;
  editable: boolean;
  edit?: boolean;
  purpose: 'development' | 'test';
  language: string;
}>();
const emit = defineEmits<{ saved: [view: ProjectSystems]; close: [] }>();
const form = ref({
  name: props.system?.name ?? '',
  purpose: props.system?.purpose ?? props.purpose,
  sid: props.system?.sid ?? '',
  sapUrl: props.system?.sapUrl ?? 'https://',
  client: props.system?.client ?? '',
  language: props.system?.language ?? props.language,
  description: props.system?.description ?? '',
  status: props.system?.status ?? 'active',
});
const initial = JSON.stringify(form.value);
const dirty = computed(() => JSON.stringify(form.value) !== initial);
const reading = ref(!!props.system && !props.edit);
function startEdit() {
  if (props.editable) reading.value = false;
}
function cancel() {
  if (!props.system) return emit('close');
  form.value = JSON.parse(initial);
  save.error.value = '';
  reading.value = true;
}
const save = useSave();
async function submit() {
  if (save.busy.value) return;
  const body = { ...form.value, rowVersion: props.system?.rowVersion };
  const next = await save.run(() =>
    props.system
      ? sapApi.update(props.projectId, props.system.id, body)
      : sapApi.create(props.projectId, body),
  );
  if (next) emit('saved', next);
}
defineExpose({ dirty, busy: save.busy, startEdit });
</script>
<template>
  <SettingsDrawer
    :title="system?.name ?? '登记 SAP 系统'"
    :description="
      system
        ? `${system.sid} · client ${system.client} · ${system.purpose === 'test' ? '测试系统' : '开发系统'}`
        : '只登记地址与 Client，不保存用户和密码。'
    "
    close-label="关闭 SAP 系统抽屉"
    note="每个人用自己的 SAP 用户登录"
    :busy="save.busy.value"
    :reading="reading"
    :editable="editable"
    @close="emit('close')"
    @submit="submit"
    @edit="startEdit"
  >
    <p v-if="save.error.value" class="error-note" role="alert">{{ save.error.value }}</p>
    <p v-if="system && !reading" class="s-drawer-note">
      修改 ADT 地址或 Client 后，所有人在该系统保存的凭据自动失效，需要重新登录。
    </p>
    <fieldset class="s-fields" :class="{ reading }" :disabled="reading">
      <section>
        <h3>基本信息</h3>
        <label class="s-field"
          ><span>名称 <b>*</b></span
          ><input
            v-model="form.name"
            maxlength="60"
            placeholder="如 S/4 开发 100"
            required
            autofocus
            :disabled="save.busy.value"
        /></label>
        <label class="s-field"
          ><span>用途 <b>*</b></span
          ><select v-model="form.purpose" :disabled="!!system || save.busy.value">
            <option value="development">开发系统</option>
            <option value="test">测试系统</option>
          </select></label
        >
        <p v-if="system" class="s-drawer-help">用途登记后不能修改；需要时删除后重新登记。</p>
        <label class="s-field"
          ><span>系统标识 <b>*</b></span
          ><input
            v-model="form.sid"
            class="mono"
            maxlength="3"
            placeholder="SID，如 S4D"
            required
            :disabled="save.busy.value"
        /></label>
        <label class="s-field"
          ><span>状态</span
          ><select v-model="form.status" :disabled="save.busy.value">
            <option value="active">启用</option>
            <option value="inactive">停用（助手不可选，历史保留）</option>
          </select></label
        >
        <label class="s-field"
          ><span>说明</span
          ><input
            v-model="form.description"
            maxlength="300"
            placeholder="如 FI 沙箱，数据每周刷新"
            :disabled="save.busy.value"
        /></label>
      </section>
      <section>
        <h3>接入配置</h3>
        <label class="s-field"
          ><span>ADT 地址 <b>*</b></span
          ><input
            v-model="form.sapUrl"
            class="mono"
            maxlength="2048"
            placeholder="https://host:44300"
            required
            :disabled="save.busy.value"
        /></label>
        <p class="s-drawer-help">填写 HTTPS 主机地址及端口，不含路径或凭据。</p>
        <label class="s-field"
          ><span>Client <b>*</b></span
          ><input
            v-model="form.client"
            class="mono"
            maxlength="3"
            placeholder="100"
            required
            :disabled="save.busy.value"
        /></label>
        <label class="s-field"
          ><span>登录语言</span
          ><input
            v-model="form.language"
            class="mono"
            maxlength="2"
            placeholder="ZH"
            :disabled="save.busy.value"
        /></label>
      </section>
    </fieldset>
    <template #actions>
      <button type="button" class="secondary-button" :disabled="save.busy.value" @click="cancel">
        取消</button
      ><button class="primary-button" :disabled="save.busy.value">
        {{ save.busy.value ? '正在处理…' : '保存' }}
      </button>
    </template>
  </SettingsDrawer>
</template>
