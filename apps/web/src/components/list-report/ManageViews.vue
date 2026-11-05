<script setup lang="ts" generic="T extends { id: string }">
import { ref, watch } from 'vue';
import { Trash2 } from '@lucide/vue';
import type { SavedView } from '@sap-delivery-workbench/contracts/list-report/views';
import { askConfirmation } from '../../services/confirmation';
import BaseButton from '../base/BaseButton.vue';
import BaseDialog from '../base/BaseDialog.vue';
import BaseIconButton from '../base/BaseIconButton.vue';
import BaseInput from '../base/BaseInput.vue';
import type { ListReportApi } from './useListReport';

// 管理视图: rename, default, apply on open, delete. Each change is saved as it is made.
const props = defineProps<{ report: ListReportApi<T> }>();
const open = defineModel<boolean>('open', { default: false });
const error = ref('');
const names = ref<Record<string, string>>({});
watch(
  [open, props.report.views],
  () => {
    names.value = Object.fromEntries(props.report.views.value.map((v) => [v.id, v.name]));
    if (open.value) error.value = '';
  },
  { immediate: true },
);
async function run(action: () => Promise<unknown>) {
  error.value = '';
  try {
    await action();
  } catch (e) {
    error.value = (e as Error).message;
    names.value = Object.fromEntries(props.report.views.value.map((v) => [v.id, v.name]));
  }
}
function rename(view: SavedView) {
  const name = names.value[view.id]?.trim();
  if (name && name !== view.name) void run(() => props.report.updateView(view.id, { name }));
  else names.value[view.id] = view.name;
}
async function remove(view: SavedView) {
  // The confirmation sits outside this modal dialog, which would block clicks on it: step aside.
  open.value = false;
  const yes = await askConfirmation(
    `确定删除视图“${view.name}”吗？删除后不能恢复，开发项不受影响。`,
  );
  open.value = true;
  if (yes) void run(() => props.report.removeView(view.id));
}
function clearDefault() {
  const current = props.report.views.value.find((v) => v.isDefault);
  if (current) void run(() => props.report.updateView(current.id, { isDefault: false }));
}
const contents = (view: SavedView) =>
  [
    `字段 ${view.state.filterFields.length}`,
    `条件 ${Object.keys(view.state.conditions).length}`,
    view.state.columns ? `列 ${view.state.columns.filter((c) => c.visible).length}` : '默认列',
    view.state.sortOrder ? '排序 1' : '',
  ]
    .filter(Boolean)
    .join(' · ');
</script>

<template>
  <BaseDialog
    v-model:open="open"
    wide
    title="管理视图"
    description="每项修改立即保存；没有设默认视图时，进入列表打开“标准”。"
  >
    <div class="lr-manage">
      <table>
        <thead>
          <tr>
            <th scope="col">名称</th>
            <th scope="col">我的默认</th>
            <th scope="col">打开即应用</th>
            <th scope="col">包含</th>
            <th scope="col"><span class="sr-only">操作</span></th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>标准</td>
            <td>
              <input
                type="radio"
                name="list-report-default"
                aria-label="标准设为默认"
                :checked="report.isStandardDefault.value"
                @change="clearDefault"
              />
            </td>
            <td><input type="checkbox" checked disabled aria-label="标准打开即应用" /></td>
            <td class="lr-manage-muted">默认字段 · 无条件 · 默认列</td>
            <td class="lr-manage-muted">系统</td>
          </tr>
          <tr v-for="view in report.views.value" :key="view.id">
            <td>
              <BaseInput
                v-model="names[view.id]"
                :label="'视图名称 ' + view.name"
                @focusout="rename(view)"
                @keydown.enter="rename(view)"
              />
            </td>
            <td>
              <input
                type="radio"
                name="list-report-default"
                :aria-label="view.name + '设为默认'"
                :checked="view.isDefault"
                @change="run(() => report.updateView(view.id, { isDefault: true }))"
              />
            </td>
            <td>
              <input
                type="checkbox"
                :aria-label="view.name + '打开即应用'"
                :checked="view.autoApply"
                @change="
                  run(() =>
                    report.updateView(view.id, {
                      autoApply: ($event.target as HTMLInputElement).checked,
                    }),
                  )
                "
              />
            </td>
            <td class="lr-manage-muted">{{ contents(view) }}</td>
            <td>
              <BaseIconButton size="sm" :label="'删除视图 ' + view.name" @click="remove(view)"
                ><Trash2
              /></BaseIconButton>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-if="error" class="error-note" role="alert">{{ error }}</p>
    <template #footer>
      <BaseButton variant="primary" @click="open = false">完成</BaseButton>
    </template>
  </BaseDialog>
</template>
