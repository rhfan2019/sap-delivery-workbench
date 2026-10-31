<script setup lang="ts">
import { computed, ref } from 'vue';
import SettingsDrawer from '../settings/SettingsDrawer.vue';
import { useSave } from '../settings/useLoad';
import { adminApi, type Customer } from './api';

// A customer record in the list's drawer (DESIGN.md 5 “抽屉”): a saved one opens to read unless
// its 编辑 was clicked (development-discipline.md 4.1).
const props = defineProps<{ customer: Customer | null; editable: boolean; edit?: boolean }>();
const emit = defineEmits<{ saved: []; close: [] }>();
const form = ref({
  name: props.customer?.name ?? '',
  code: props.customer?.code ?? '',
  customerKind: props.customer?.customerKind ?? 'external',
  status: props.customer?.status ?? 'active',
  description: props.customer?.description ?? '',
});
const initial = JSON.stringify(form.value);
const dirty = computed(() => JSON.stringify(form.value) !== initial);
const ready = computed(() => !!form.value.name && !!form.value.code);
const reading = ref(!!props.customer && !props.edit);
function startEdit() {
  if (props.editable) reading.value = false;
}
function cancel() {
  if (!props.customer) return emit('close');
  form.value = JSON.parse(initial);
  save.error.value = '';
  reading.value = true;
}
const save = useSave();
async function submit() {
  if (!ready.value || save.busy.value) return;
  const body = { ...(props.customer ?? {}), ...form.value };
  if (await save.run(() => adminApi.saveCustomer(body, props.customer?.id))) emit('saved');
}
defineExpose({ dirty, busy: save.busy, startEdit });
</script>
<template>
  <SettingsDrawer
    :title="customer?.name ?? '新建客户'"
    :description="customer ? customer.code : '客户档案。SAP 系统形态、团队与系统登记在各项目中。'"
    close-label="关闭客户抽屉"
    :note="customer ? `已有 ${customer.projectCount} 个项目` : ''"
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
          ><span>客户名称 <b>*</b></span
          ><input
            v-model="form.name"
            maxlength="200"
            required
            autofocus
            :disabled="save.busy.value"
        /></label>
        <label class="s-field"
          ><span>客户编码 <b>*</b></span
          ><input
            v-model="form.code"
            class="mono"
            maxlength="32"
            required
            :disabled="save.busy.value"
        /></label>
        <label class="s-field"
          ><span>客户类型</span
          ><select v-model="form.customerKind" :disabled="save.busy.value">
            <option value="external">外部客户</option>
            <option value="self">本企业（内部项目）</option>
          </select></label
        >
        <label class="s-field"
          ><span>状态</span
          ><select v-model="form.status" :disabled="save.busy.value">
            <option value="active">启用</option>
            <option value="inactive">停用（不能再为其新建项目）</option>
          </select></label
        >
        <label class="s-field top"
          ><span>说明</span
          ><textarea
            v-model="form.description"
            class="s-textarea"
            maxlength="4000"
            placeholder="如行业、合作背景"
            :disabled="save.busy.value"
          />
        </label>
      </section>
    </fieldset>
    <template #actions>
      <button type="button" class="secondary-button" :disabled="save.busy.value" @click="cancel">
        取消</button
      ><button class="primary-button" :disabled="save.busy.value || !ready">
        {{ save.busy.value ? '正在处理…' : '保存' }}
      </button>
    </template>
  </SettingsDrawer>
</template>
