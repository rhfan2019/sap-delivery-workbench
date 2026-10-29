<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { PROJECT_SCOPES } from '@sap-delivery-workbench/contracts/access/catalog';
import BaseAvatar from '../../components/base/BaseAvatar.vue';
import BaseSkeleton from '../../components/base/BaseSkeleton.vue';
import BaseTag from '../../components/base/BaseTag.vue';
import SettingsDrawer from '../settings/SettingsDrawer.vue';
import { useLoad, useSave } from '../settings/useLoad';
import PermissionTree from './PermissionTree.vue';
import { accessApi, day, type Role } from './api';

// One role in the list's wide drawer (docs/specs/project-access-admin.md 2.5, 2.8; DESIGN.md 5
// “抽屉”): its basic information, its permissions or member roles, who holds it and which
// composites contain it. System roles are read-only and may be copied.
const props = defineProps<{ roleId: string; roles: Role[]; manage: boolean }>();
const emit = defineEmits<{
  saved: [role: Role];
  close: [];
  open: [id: string];
  copy: [role: Role];
}>();
const { data: role, loading, error, reload } = useLoad(() => accessApi.role(props.roleId));
const name = ref(''),
  description = ref(''),
  status = ref<'active' | 'inactive'>('active'),
  permissions = ref<string[]>([]),
  members = ref<string[]>([]);
onMounted(async () => {
  await reload();
  const r = role.value;
  if (!r) return;
  name.value = r.name;
  description.value = r.description;
  status.value = r.status;
  permissions.value = [...r.permissions];
  members.value = r.members.map((m) => m.id);
});
const editable = computed(() => !!role.value && !role.value.builtIn && props.manage);
const singles = computed(() =>
  props.roles.filter(
    (r) => r.kind === 'single' && (role.value?.scope === 'organization' || r.scope === 'project'),
  ),
);
// The live union of the chosen single roles, as the server computes it (active members only).
const merged = computed(() => {
  if (role.value?.kind !== 'composite') return permissions.value;
  return [
    ...new Set(
      singles.value
        .filter((s) => members.value.includes(s.id) && s.status === 'active')
        .flatMap((s) => s.permissions),
    ),
  ];
});
const sorted = (list: string[]) => JSON.stringify([...list].sort());
const dirty = computed(() => {
  const r = role.value;
  if (!r || !editable.value) return false;
  return (
    name.value !== r.name ||
    description.value !== r.description ||
    status.value !== r.status ||
    sorted(permissions.value) !== sorted(r.permissions) ||
    sorted(members.value) !== sorted(r.members.map((m) => m.id))
  );
});
const save = useSave();
const ready = computed(
  () =>
    dirty.value &&
    !!name.value.trim() &&
    (role.value?.kind !== 'composite' || members.value.length > 0),
);
async function submit() {
  const r = role.value;
  if (!r || !ready.value || save.busy.value) return;
  const saved = await save.run(() =>
    accessApi.saveRole(r.id, {
      name: name.value,
      description: description.value,
      status: status.value,
      permissions: permissions.value,
      members: members.value,
      rowVersion: r.rowVersion,
    }),
  );
  if (saved) emit('saved', saved);
}
const typeText = computed(() =>
  role.value
    ? (role.value.scope === 'project' ? '项目级' : '企业级') +
      (role.value.kind === 'composite' ? '复合角色' : '单一角色')
    : '',
);
const usage = computed(() => {
  const r = role.value;
  if (!r) return '';
  const parts = [`直接或经由复合角色持有，共 ${r.holders.length} 次分配`];
  if (r.positionCount) parts.push(`${r.positionCount} 个职位把它设为默认角色`);
  return parts.join('；') + '。';
});
defineExpose({ dirty, busy: save.busy });
</script>
<template>
  <SettingsDrawer
    :title="role?.name ?? '角色'"
    :description="role ? typeText + ' · ' + role.code : '正在读取角色…'"
    close-label="关闭角色抽屉"
    :note="editable ? '保存后立即生效' : role?.builtIn ? '系统角色只读' : '只读'"
    :busy="save.busy.value"
    wide
    @close="emit('close')"
    @submit="submit"
  >
    <p v-if="error || save.error.value" class="error-note" role="alert">
      {{ error || save.error.value }}
    </p>
    <BaseSkeleton v-if="loading && !role" height="320px" />
    <template v-if="role">
      <p v-if="role.builtIn" class="s-drawer-note">
        系统角色随版本更新，不能修改；需要调整时复制为新角色。
      </p>
      <section>
        <h3>基本信息</h3>
        <label class="s-field"
          ><span>编码</span><input :value="role.code" class="mono" disabled
        /></label>
        <label class="s-field"><span>类型</span><input :value="typeText" disabled /></label>
        <label class="s-field"
          ><span>名称 <b v-if="editable">*</b></span
          ><input v-model="name" maxlength="60" required :disabled="!editable || save.busy.value"
        /></label>
        <label class="s-field top"
          ><span>说明</span
          ><textarea
            v-model="description"
            maxlength="300"
            :disabled="!editable || save.busy.value"
          />
        </label>
        <div class="s-field">
          <span>状态</span>
          <label class="s-check state"
            ><input
              type="checkbox"
              :checked="status === 'active'"
              :disabled="!editable || save.busy.value"
              @change="status = status === 'active' ? 'inactive' : 'active'"
            />启用</label
          >
        </div>
        <p class="s-drawer-help">停用后，持有这个角色的人立即失去它带来的权限。</p>
      </section>

      <section v-if="role.kind === 'composite'">
        <h3>包含的单一角色</h3>
        <p class="s-drawer-help">合并后共 {{ merged.length }} 个权限点。</p>
        <div class="member-grid">
          <label v-for="s in singles" :key="s.id" class="s-check member">
            <input
              v-model="members"
              type="checkbox"
              :value="s.id"
              :disabled="!editable || save.busy.value"
            />
            <span
              ><strong
                >{{ s.name
                }}<span v-if="s.status === 'inactive'" class="s-badge muted">停用</span></strong
              ><small>{{ s.description }}</small></span
            >
          </label>
        </div>
        <p v-if="editable && !members.length" class="s-drawer-help">
          复合角色至少包含一个单一角色。
        </p>
      </section>
      <section>
        <h3>{{ role.kind === 'composite' ? '合并后的权限点' : '权限点' }}</h3>
        <p class="s-drawer-help">
          {{
            role.kind === 'composite'
              ? '由包含的单一角色决定，只读。'
              : '勾选操作或字段权限时会同时勾选所在分组的查看权限。'
          }}
        </p>
        <PermissionTree
          v-if="role.kind === 'single'"
          v-model="permissions"
          :scope="role.scope"
          :readonly="!editable || save.busy.value"
        />
        <PermissionTree v-else :model-value="merged" :scope="role.scope" readonly />
      </section>

      <section>
        <h3>分配情况</h3>
        <p class="s-drawer-help">{{ usage }}</p>
        <div class="s-list">
          <RouterLink
            v-for="h in role.holders"
            :key="h.assignmentId"
            :to="'/settings/users?user=' + h.userId"
            class="s-list-row"
          >
            <BaseAvatar :name="h.displayName" :size="24" />
            <span class="s-list-main">
              <strong>{{ h.displayName }}</strong>
              <small>{{
                h.level === 'project'
                  ? '项目 · ' + h.projectName
                  : '企业级 · ' + PROJECT_SCOPES[h.projectScope as 'all']
              }}</small>
            </span>
            <span class="s-list-side">
              <BaseTag v-if="h.viaCode !== role.code" variant="outline"
                >经由 {{ h.viaName }}</BaseTag
              >
              <span v-if="h.validTo">至 {{ day(h.validTo) }}</span>
            </span>
          </RouterLink>
          <p v-if="!role.holders.length" class="empty-note">还没有分配给任何人。</p>
        </div>
        <template v-if="role.containedIn.length">
          <h4>包含于</h4>
          <p class="s-drawer-help">这些复合角色包含本角色。</p>
          <div class="s-list">
            <button
              v-for="c in role.containedIn"
              :key="c.id"
              type="button"
              class="s-list-row"
              @click="emit('open', c.id)"
            >
              <span class="s-list-main"
                ><strong>{{ c.name }}</strong
                ><small class="s-mono">{{ c.code }}</small></span
              >
            </button>
          </div>
        </template>
      </section>
    </template>
    <template #actions>
      <button
        v-if="role && manage"
        type="button"
        class="secondary-button"
        :disabled="save.busy.value"
        @click="emit('copy', role)"
      >
        复制为新角色</button
      ><button
        type="button"
        class="secondary-button"
        :disabled="save.busy.value"
        @click="emit('close')"
      >
        {{ editable ? '取消' : '关闭' }}</button
      ><button v-if="editable" class="primary-button" :disabled="save.busy.value || !ready">
        {{ save.busy.value ? '正在保存…' : '保存' }}
      </button>
    </template>
  </SettingsDrawer>
</template>
<style scoped>
.member-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-2);
}
.s-drawer-body .member {
  align-items: flex-start;
  margin-top: 0;
  padding: var(--space-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-8);
}
.member > span {
  display: grid;
  gap: var(--space-0-5);
}
.member strong {
  font-weight: var(--weight-550);
}
.member small {
  color: var(--text-muted);
  font-size: var(--font-12);
}
.s-drawer-body .state {
  margin-top: 0;
}
.s-drawer-body h4 {
  margin: var(--space-5) 0 0;
  font-size: var(--font-14);
  font-weight: var(--weight-550);
}
.s-list {
  border: 1px solid var(--border);
  border-radius: var(--radius-8);
}
.empty-note {
  margin: 0;
  padding: var(--space-4);
  color: var(--text-muted);
  font-size: var(--font-14);
}
@media (max-width: 560px) {
  .member-grid {
    grid-template-columns: 1fr;
  }
}
</style>
