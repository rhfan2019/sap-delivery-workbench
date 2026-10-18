<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { Search } from '@lucide/vue';
import BaseButton from '../../components/base/BaseButton.vue';
import BaseDialog from '../../components/base/BaseDialog.vue';
import BaseSkeleton from '../../components/base/BaseSkeleton.vue';
import BaseTag from '../../components/base/BaseTag.vue';
import { toast } from '../../components/base/toast';
import { can } from '../../services/session';
import SettingsPage from '../settings/SettingsPage.vue';
import SettingsCard from '../settings/SettingsCard.vue';
import { useLoad, useSave } from '../settings/useLoad';
import { adminApi, type Customer } from './api';
import '../settings/settings.css';

// 企业 → 客户: customer records. The SAP landscape and everything else live on projects.
const { data, loading, error, reload } = useLoad(adminApi.customers);
onMounted(reload);
const query = ref('');
const shown = computed(() =>
  (data.value ?? []).filter((c) =>
    (c.name + c.code).toLowerCase().includes(query.value.trim().toLowerCase()),
  ),
);
const editing = ref<Partial<Customer> | null>(null);
const save = useSave();
function open(c?: Customer) {
  save.error.value = '';
  editing.value = c
    ? { ...c }
    : { code: '', name: '', customerKind: 'external', status: 'active', description: '' };
}
async function submit() {
  const c = editing.value!;
  if (await save.run(() => adminApi.saveCustomer(c, c.id))) {
    editing.value = null;
    await reload();
    toast('客户已保存。', 'green');
  }
}
</script>
<template>
  <SettingsPage
    title="客户"
    description="客户档案。项目的 SAP 系统形态、团队与系统登记在各项目中。"
  >
    <template #actions>
      <BaseButton v-if="can('customer:manage')" variant="primary" @click="open()"
        >新建客户</BaseButton
      >
    </template>
    <p v-if="error" class="s-error" role="alert">{{ error }}</p>
    <label class="s-search"
      ><Search :size="14" /><input
        v-model="query"
        placeholder="搜索客户名称或编码"
        aria-label="搜索客户"
    /></label>
    <BaseSkeleton v-if="loading && !data" height="200px" />
    <SettingsCard v-if="data" flush>
      <div class="s-list">
        <button
          v-for="c in shown"
          :key="c.id"
          type="button"
          class="s-list-row"
          :disabled="!can('customer:manage')"
          @click="open(c)"
        >
          <span class="s-list-main">
            <strong>{{ c.name }}</strong>
            <small>{{ c.code }}{{ c.description ? ' · ' + c.description : '' }}</small>
          </span>
          <span class="s-list-side">
            <BaseTag v-if="c.customerKind === 'self'" tone="purple">本企业</BaseTag>
            <BaseTag v-if="c.status === 'inactive'" strike>停用</BaseTag>
            <span>{{ c.projectCount }} 个项目</span>
          </span>
        </button>
        <p v-if="!shown.length" class="empty-note">
          {{ query ? '没有匹配的客户。' : '还没有客户。' }}
        </p>
      </div>
    </SettingsCard>

    <BaseDialog
      :open="!!editing"
      :title="editing?.id ? '编辑客户' : '新建客户'"
      @update:open="(v) => !v && (editing = null)"
    >
      <form v-if="editing" class="dialog-form" @submit.prevent="submit">
        <label
          >客户名称<input v-model="editing.name" class="s-input" maxlength="200" required
        /></label>
        <label
          >客户编码<input v-model="editing.code" class="s-input mono" maxlength="32" required
        /></label>
        <label
          >客户类型<select v-model="editing.customerKind" class="s-select">
            <option value="external">外部客户</option>
            <option value="self">本企业（内部项目）</option>
          </select></label
        >
        <label class="s-check"
          ><input
            type="checkbox"
            :checked="editing.status === 'active'"
            @change="editing.status = editing.status === 'active' ? 'inactive' : 'active'"
          />启用（停用后不能再为其新建项目）</label
        >
        <label
          >说明<textarea v-model="editing.description" class="s-textarea" maxlength="4000" />
        </label>
        <p v-if="save.error.value" class="s-error" role="alert">{{ save.error.value }}</p>
      </form>
      <template #footer>
        <BaseButton @click="editing = null">取消</BaseButton>
        <BaseButton
          variant="primary"
          :loading="save.busy.value"
          :disabled="!editing?.name || !editing?.code"
          @click="submit"
          >保存</BaseButton
        >
      </template>
    </BaseDialog>
  </SettingsPage>
</template>
<style scoped>
.empty-note {
  margin: 0;
  padding: var(--space-4);
  color: var(--text-muted);
}
.dialog-form {
  display: grid;
  gap: var(--space-3);
}
.dialog-form > label:not(.s-check) {
  display: grid;
  gap: var(--space-1);
  color: var(--text-muted);
  font-size: var(--font-12);
}
</style>
