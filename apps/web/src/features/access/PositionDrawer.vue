<script setup lang="ts">
import { computed, ref } from 'vue';
import SettingsDrawer from '../settings/SettingsDrawer.vue';
import { useSave } from '../settings/useLoad';
import { accessApi, type Position, type Role } from './api';

// A position and its default roles in the list's drawer (docs/specs/project-access-admin.md 2.6;
// DESIGN.md 5 “抽屉”): a saved one opens to read unless its 编辑 was clicked
// (development-discipline.md 4.1).
const props = defineProps<{
  position: Position | null;
  roles: Role[];
  editable: boolean;
  edit?: boolean;
}>();
const emit = defineEmits<{ saved: []; close: [] }>();
const form = ref({
  code: props.position?.code ?? '',
  name: props.position?.name ?? '',
  description: props.position?.description ?? '',
  status: props.position?.status ?? 'active',
  roleIds: props.position?.roles.map((r) => r.id) ?? [],
});
const snapshot = () => JSON.stringify({ ...form.value, roleIds: [...form.value.roleIds].sort() });
const initial = snapshot();
const dirty = computed(() => snapshot() !== initial);
const ready = computed(() => !!form.value.name && !!form.value.code);
const groups = computed(() => [
  {
    label: '企业级默认角色',
    help: '设置职位时可一并授予，范围为全部项目。',
    items: props.roles
      .filter((r) => r.scope === 'organization' && r.kind === 'composite')
      .concat(props.roles.filter((r) => r.scope === 'organization' && r.kind === 'single')),
  },
  {
    label: '默认项目角色',
    help: '用户加入项目时带出。',
    items: props.roles.filter((r) => r.scope === 'project' && r.kind === 'composite'),
  },
]);
const reading = ref(!!props.position && !props.edit);
function startEdit() {
  if (props.editable) reading.value = false;
}
function cancel() {
  if (!props.position) return emit('close');
  form.value = JSON.parse(initial);
  save.error.value = '';
  reading.value = true;
}
const save = useSave();
async function submit() {
  if (!ready.value || save.busy.value) return;
  const body = {
    id: props.position?.id ?? null,
    ...form.value,
    rowVersion: props.position?.rowVersion,
  };
  if (await save.run(() => accessApi.savePosition(props.position?.id ?? null, body))) emit('saved');
}
defineExpose({ dirty, busy: save.busy, startEdit });
</script>
<template>
  <SettingsDrawer
    :title="position?.name ?? '新建职位'"
    :description="position ? position.code : '职位用来带出默认角色。'"
    close-label="关闭职位抽屉"
    note="修改默认角色不会改动已有的分配"
    :busy="save.busy.value"
    :reading="reading"
    :editable="editable"
    @close="emit('close')"
    @submit="submit"
    @edit="startEdit"
  >
    <p v-if="save.error.value" class="error-note" role="alert">{{ save.error.value }}</p>
    <fieldset class="s-fields" :class="{ reading }" :disabled="reading">
      <section>
        <h3>基本信息</h3>
        <label class="s-field"
          ><span>编码 <b>*</b></span
          ><input
            v-model="form.code"
            class="mono"
            maxlength="40"
            required
            autofocus
            :disabled="save.busy.value"
        /></label>
        <label class="s-field"
          ><span>名称 <b>*</b></span
          ><input v-model="form.name" maxlength="60" required :disabled="save.busy.value"
        /></label>
        <label class="s-field"
          ><span>状态</span
          ><select v-model="form.status" :disabled="save.busy.value">
            <option value="active">启用</option>
            <option value="inactive">停用（不能再设给用户）</option>
          </select></label
        >
        <label class="s-field"
          ><span>说明</span
          ><input
            v-model="form.description"
            maxlength="300"
            placeholder="如负责财务模块的实施顾问"
            :disabled="save.busy.value"
        /></label>
      </section>
      <section v-for="g in groups" :key="g.label">
        <h3>{{ g.label }}</h3>
        <p class="s-drawer-help">{{ g.help }}</p>
        <div class="s-checks" role="group" :aria-label="g.label">
          <label v-for="r in g.items" :key="r.id" class="s-check">
            <input
              v-model="form.roleIds"
              type="checkbox"
              :value="r.id"
              :disabled="save.busy.value"
            />{{ r.name }}
          </label>
        </div>
      </section>
    </fieldset>
    <p v-if="!roles.length" class="s-drawer-note">需要“查看角色与权限”才能选择默认角色。</p>
    <template #actions>
      <button type="button" class="secondary-button" :disabled="save.busy.value" @click="cancel">
        取消</button
      ><button class="primary-button" :disabled="save.busy.value || !ready">
        {{ save.busy.value ? '正在处理…' : '保存' }}
      </button>
    </template>
  </SettingsDrawer>
</template>
