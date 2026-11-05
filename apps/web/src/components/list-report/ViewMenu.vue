<script setup lang="ts" generic="T extends { id: string }">
import { computed, ref } from 'vue';
import { Check, ChevronDown } from '@lucide/vue';
import BaseButton from '../base/BaseButton.vue';
import BaseInput from '../base/BaseInput.vue';
import BasePopover from '../base/BasePopover.vue';
import { toast } from '../base/toast';
import ManageViews from './ManageViews.vue';
import SaveViewDialog from './SaveViewDialog.vue';
import type { ListReportApi } from './useListReport';

// The view selector (Fiori's Variant Management): switch, save, save as, manage.
const props = defineProps<{ report: ListReportApi<T> }>();
const open = ref(false);
const saving = ref(false);
const managing = ref(false);
const query = ref('');
const name = computed(() => props.report.currentView.value?.name ?? '标准');
const views = computed(() => {
  const q = query.value.trim().toLowerCase();
  return props.report.views.value.filter((v) => !q || v.name.toLowerCase().includes(q));
});
function pick(id: string) {
  props.report.openView(id);
  open.value = false;
}
async function save() {
  try {
    await props.report.saveCurrent();
    toast(`已保存视图“${name.value}”`, 'green');
  } catch (e) {
    toast((e as Error).message, 'red');
  }
}
function saveAs() {
  open.value = false;
  saving.value = true;
}
function manage() {
  open.value = false;
  managing.value = true;
}
</script>

<template>
  <div class="lr-view">
    <BasePopover v-model:open="open">
      <template #trigger>
        <button type="button" class="lr-view-name" :aria-label="'视图：' + name">
          {{ name }}<ChevronDown />
        </button>
      </template>
      <div class="lr-view-menu">
        <BaseInput
          v-if="report.views.value.length > 6"
          v-model="query"
          placeholder="搜索视图"
          label="搜索视图"
        />
        <template v-if="views.length">
          <p class="lr-view-group">我的视图</p>
          <button
            v-for="view in views"
            :key="view.id"
            type="button"
            class="lr-view-item"
            :class="{ on: view.id === report.viewId.value }"
            @click="pick(view.id)"
          >
            <span>{{ view.name }}</span>
            <em v-if="view.isDefault">默认</em>
            <Check v-if="view.id === report.viewId.value" />
          </button>
        </template>
        <p class="lr-view-group">系统</p>
        <button
          type="button"
          class="lr-view-item"
          :class="{ on: !report.viewId.value }"
          @click="pick('')"
        >
          <span>标准</span>
          <em v-if="report.isStandardDefault.value">默认</em>
          <Check v-if="!report.viewId.value" />
        </button>
        <p v-if="report.viewsError.value" class="lr-note" role="alert">
          视图加载失败：{{ report.viewsError.value }}
        </p>
        <template v-if="report.canSave.value">
          <hr />
          <button type="button" class="lr-view-item" @click="saveAs">另存为新视图</button>
          <button type="button" class="lr-view-item" @click="manage">管理视图</button>
        </template>
      </div>
    </BasePopover>
    <template v-if="report.dirty.value">
      <span class="lr-dirty">已修改</span>
      <BaseButton
        v-if="report.canSave.value && report.viewId.value"
        variant="ghost"
        size="sm"
        @click="save"
        >保存</BaseButton
      >
      <BaseButton v-else-if="report.canSave.value" variant="ghost" size="sm" @click="saveAs"
        >另存为</BaseButton
      >
    </template>
    <SaveViewDialog v-model:open="saving" :report="report" />
    <ManageViews v-model:open="managing" :report="report" />
  </div>
</template>
