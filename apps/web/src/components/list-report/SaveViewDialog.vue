<script setup lang="ts" generic="T extends { id: string }">
import { computed, ref, watch } from 'vue';
import { MAX_VIEW_NAME } from '@sap-delivery-workbench/contracts/list-report/views';
import BaseButton from '../base/BaseButton.vue';
import BaseDialog from '../base/BaseDialog.vue';
import BaseInput from '../base/BaseInput.vue';
import { toast } from '../base/toast';
import type { ListReportApi } from './useListReport';

// 另存为新视图: names the view and says plainly what it will keep.
const props = defineProps<{ report: ListReportApi<T> }>();
const open = defineModel<boolean>('open', { default: false });
const name = ref('');
const isDefault = ref(false);
const autoApply = ref(true);
const busy = ref(false);
const error = ref('');
watch(open, (value) => {
  if (!value) return;
  name.value = '';
  isDefault.value = false;
  autoApply.value = true;
  error.value = '';
});
const label = (key: string) => props.report.fieldOf(key)?.label ?? key;
const columnLabels = computed(() =>
  props.report.shownKeys.value
    .filter((key) => key !== 'actions')
    .map((key) => props.report.columns.value.find((c) => c.key === key)?.label ?? key),
);
const sortLabel = computed(() => {
  const r = props.report;
  if (!r.sortField.value || !r.sortOrder.value) return '';
  const column = r.columns.value.find((c) => c.key === r.sortField.value);
  return `${column?.label ?? r.sortField.value} ${r.sortOrder.value === 'asc' ? '升序' : '降序'}`;
});
async function submit() {
  error.value = '';
  const text = name.value.trim();
  if (!text) {
    error.value = '请填写视图名称。';
    return;
  }
  if (text.length > MAX_VIEW_NAME) {
    error.value = `视图名称不能超过 ${MAX_VIEW_NAME} 个字符。`;
    return;
  }
  busy.value = true;
  try {
    await props.report.saveAs({
      name: text,
      isDefault: isDefault.value,
      autoApply: autoApply.value,
    });
    toast(`已保存视图“${text}”`, 'green');
    open.value = false;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <BaseDialog
    v-model:open="open"
    wide
    title="另存为新视图"
    description="视图只有你自己能看到，可以随时切换、修改或删除。"
  >
    <form class="lr-save" @submit.prevent="submit">
      <div>
        <span class="lr-pair-label">视图名称</span>
        <BaseInput v-model="name" placeholder="SD/MM 本月开发" label="视图名称" />
      </div>
      <label class="lr-check"
        ><input v-model="isDefault" type="checkbox" />设为我的默认<em
          >下次进入这个列表时自动打开</em
        ></label
      >
      <label class="lr-check"
        ><input v-model="autoApply" type="checkbox" />打开即应用<em
          >关闭后，打开视图先显示条件，点“应用”才显示结果</em
        ></label
      >
      <div class="lr-save-summary">
        <h3>这个视图将保存</h3>
        <dl>
          <dt>筛选栏字段 {{ report.filterFields.value.length }}</dt>
          <dd>{{ report.filterFields.value.map(label).join('、') }}</dd>
          <dt>条件 {{ report.conditionCount.value }}</dt>
          <dd>
            {{
              report.activeFilters.value
                .filter((f) => !f.key.startsWith('_'))
                .map((f) => f.label)
                .join('；') || '无'
            }}
          </dd>
          <dt>表格列 {{ columnLabels.length }}</dt>
          <dd>{{ columnLabels.join('、') }}</dd>
          <dt>排序</dt>
          <dd>{{ sortLabel || '默认' }}</dd>
        </dl>
      </div>
      <p v-if="error" class="error-note" role="alert">{{ error }}</p>
    </form>
    <template #footer>
      <BaseButton @click="open = false">取消</BaseButton>
      <BaseButton variant="primary" :loading="busy" @click="submit">保存</BaseButton>
    </template>
  </BaseDialog>
</template>
