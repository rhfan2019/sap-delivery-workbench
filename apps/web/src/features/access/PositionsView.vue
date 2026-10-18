<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import BaseButton from '../../components/base/BaseButton.vue';
import BaseDialog from '../../components/base/BaseDialog.vue';
import BaseSkeleton from '../../components/base/BaseSkeleton.vue';
import BaseTag from '../../components/base/BaseTag.vue';
import { toast } from '../../components/base/toast';
import { askConfirmation } from '../../services/confirmation';
import { can } from '../../services/session';
import SettingsPage from '../settings/SettingsPage.vue';
import SettingsCard from '../settings/SettingsCard.vue';
import { useLoad, useSave } from '../settings/useLoad';
import { accessApi, type Position, type Role } from './api';
import '../settings/settings.css';

// 企业 → 职位 (docs/specs/project-access-admin.md 2.6): a position carries default roles. They
// are used when a user gets the position (organization roles) and when a user joins a project
// (project roles); changing them never rewrites existing assignments.
const { data, loading, error, reload } = useLoad(accessApi.positions);
const roles = ref<Role[]>([]);
onMounted(async () => {
  await reload();
  roles.value = can('role:view') ? await accessApi.roles().catch(() => []) : [];
});
const manage = computed(() => can('position:manage'));
const editing = ref<{
  id: string | null;
  code: string;
  name: string;
  description: string;
  status: string;
  roleIds: string[];
  rowVersion?: string;
} | null>(null);
const save = useSave();
function open(p?: Position) {
  save.error.value = '';
  editing.value = p
    ? {
        id: p.id,
        code: p.code,
        name: p.name,
        description: p.description,
        status: p.status,
        roleIds: p.roles.map((r) => r.id),
        rowVersion: p.rowVersion,
      }
    : { id: null, code: '', name: '', description: '', status: 'active', roleIds: [] };
}
async function submit() {
  const e = editing.value!;
  if (await save.run(() => accessApi.savePosition(e.id, e))) {
    editing.value = null;
    await reload();
    toast('职位已保存。', 'green');
  }
}
async function remove() {
  const e = editing.value!;
  if (!(await askConfirmation(`删除职位“${e.name}”？`))) return;
  if (await save.run(() => accessApi.deletePosition(e.id!, e.rowVersion!))) {
    editing.value = null;
    await reload();
  }
}
const groups = computed(() => [
  {
    label: '企业级默认角色（设置职位时可一并授予，范围为全部项目）',
    items: roles.value
      .filter((r) => r.scope === 'organization' && r.kind === 'composite')
      .concat(roles.value.filter((r) => r.scope === 'organization' && r.kind === 'single')),
  },
  {
    label: '加入项目时的默认项目角色',
    items: roles.value.filter((r) => r.scope === 'project' && r.kind === 'composite'),
  },
]);
</script>
<template>
  <SettingsPage
    title="职位"
    description="职位是用户在实施方的岗位，用来带出默认角色。修改默认角色不会改动已有的分配。"
  >
    <template #actions>
      <BaseButton v-if="manage" variant="primary" @click="open()">新建职位</BaseButton>
    </template>
    <p v-if="error" class="s-error" role="alert">{{ error }}</p>
    <BaseSkeleton v-if="loading && !data" height="200px" />
    <SettingsCard v-if="data" flush>
      <div class="s-list">
        <button
          v-for="p in data"
          :key="p.id"
          type="button"
          class="s-list-row"
          :disabled="!manage"
          @click="open(p)"
        >
          <span class="s-list-main">
            <strong
              >{{ p.name }} <span class="s-mono code">{{ p.code }}</span></strong
            >
            <small>{{ p.description || '—' }}</small>
          </span>
          <span class="s-list-side">
            <BaseTag
              v-for="r in p.roles"
              :key="r.id"
              :tone="r.scope === 'project' ? 'blue' : 'purple'"
              >{{ r.name }}</BaseTag
            >
            <BaseTag v-if="p.status === 'inactive'" strike>停用</BaseTag>
            <span>{{ p.userCount }} 人</span>
          </span>
        </button>
      </div>
    </SettingsCard>

    <BaseDialog
      :open="!!editing"
      :title="editing?.id ? '编辑职位' : '新建职位'"
      wide
      @update:open="(v) => !v && (editing = null)"
    >
      <form v-if="editing" class="position-form" @submit.prevent="submit">
        <div class="s-grid-2">
          <label>编码<input v-model="editing.code" class="s-input mono" maxlength="40" /></label>
          <label>名称<input v-model="editing.name" class="s-input" maxlength="60" /></label>
        </div>
        <label>说明<input v-model="editing.description" class="s-input" maxlength="300" /></label>
        <label class="s-check"
          ><input
            type="checkbox"
            :checked="editing.status === 'active'"
            @change="editing.status = editing.status === 'active' ? 'inactive' : 'active'"
          />启用（停用后不能再设给用户）</label
        >
        <fieldset v-for="g in groups" :key="g.label" class="role-set">
          <legend>{{ g.label }}</legend>
          <label v-for="r in g.items" :key="r.id" class="s-check">
            <input v-model="editing.roleIds" type="checkbox" :value="r.id" />{{ r.name }}
          </label>
        </fieldset>
        <p v-if="!roles.length" class="s-note">需要“查看角色与权限”才能选择默认角色。</p>
        <p v-if="save.error.value" class="s-error" role="alert">{{ save.error.value }}</p>
      </form>
      <template #footer>
        <BaseButton v-if="editing?.id" variant="danger" class="left" @click="remove"
          >删除</BaseButton
        >
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
.code {
  margin-left: var(--space-1-5);
  color: var(--text-subtle);
  font-weight: var(--weight-400);
}
.position-form {
  display: grid;
  gap: var(--space-3);
}
.position-form > label:not(.s-check),
.position-form .s-grid-2 label {
  display: grid;
  gap: var(--space-1);
  color: var(--text-muted);
  font-size: var(--font-12);
}
.role-set {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-4);
  margin: 0;
  padding: var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-8);
}
.role-set legend {
  padding: 0 var(--space-1);
  color: var(--text-muted);
  font-size: var(--font-12);
}
.left {
  margin-right: auto;
}
</style>
