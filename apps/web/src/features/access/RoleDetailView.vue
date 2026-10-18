<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import BaseAvatar from '../../components/base/BaseAvatar.vue';
import BaseButton from '../../components/base/BaseButton.vue';
import BaseSkeleton from '../../components/base/BaseSkeleton.vue';
import BaseTag from '../../components/base/BaseTag.vue';
import { toast } from '../../components/base/toast';
import { askConfirmation } from '../../services/confirmation';
import { can } from '../../services/session';
import SettingsPage from '../settings/SettingsPage.vue';
import SettingsCard from '../settings/SettingsCard.vue';
import SettingsField from '../settings/SettingsField.vue';
import { useLoad, useSave } from '../settings/useLoad';
import PermissionTree from './PermissionTree.vue';
import { accessApi, day, type Role, type RoleDetail } from './api';
import '../settings/settings.css';

// One role (docs/specs/project-access-admin.md 2.5, 2.8): its permissions or members, who holds
// it and which composites contain it. System roles are read-only and may be copied.
const route = useRoute();
const router = useRouter();
const id = computed(() => String(route.params.id));
const { data: role, loading, error, reload } = useLoad(() => accessApi.role(id.value));
const all = ref<Role[]>([]);
const name = ref(''),
  description = ref(''),
  status = ref<'active' | 'inactive'>('active'),
  permissions = ref<string[]>([]),
  members = ref<string[]>([]);
function reset(r: RoleDetail | null) {
  if (!r) return;
  name.value = r.name;
  description.value = r.description;
  status.value = r.status;
  permissions.value = [...r.permissions];
  members.value = r.members.map((m) => m.id);
}
watch(role, reset);
watch(
  id,
  async () => {
    await reload();
    all.value = await accessApi.roles().catch(() => []);
  },
  { immediate: true },
);
const editable = computed(() => !!role.value && !role.value.builtIn && can('role:manage'));
const singles = computed(() =>
  all.value.filter(
    (r) => r.kind === 'single' && (role.value?.scope === 'organization' || r.scope === 'project'),
  ),
);
const merged = computed(() => {
  if (role.value?.kind !== 'composite') return permissions.value;
  return [
    ...new Set(
      singles.value.filter((s) => members.value.includes(s.id)).flatMap((s) => s.permissions),
    ),
  ];
});
const dirty = computed(() => {
  const r = role.value;
  if (!r) return false;
  return (
    name.value !== r.name ||
    description.value !== r.description ||
    status.value !== r.status ||
    JSON.stringify([...permissions.value].sort()) !== JSON.stringify([...r.permissions].sort()) ||
    JSON.stringify([...members.value].sort()) !== JSON.stringify(r.members.map((m) => m.id).sort())
  );
});
const save = useSave();
async function submit() {
  const r = role.value!;
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
  if (saved) {
    await reload();
    toast('角色已保存。', 'green');
  }
}
const removal = useSave();
async function remove() {
  const r = role.value!;
  if (!(await askConfirmation(`删除角色“${r.name}”？`))) return;
  if (await removal.run(() => accessApi.deleteRole(r.id, r.rowVersion))) {
    toast('角色已删除。', 'green');
    await router.push('/settings/roles');
  }
}
const copy = useSave();
async function duplicate() {
  const r = role.value!;
  const created = await copy.run(() =>
    accessApi.createRole({
      code:
        ('Z_' + r.code.replace(/^(SYS_|C_|PRJ_|DL_|AG_|Z_)/, '')).slice(0, 36) +
        '_' +
        String(Date.now()).slice(-3),
      name: r.name + '（副本）',
      description: r.description,
      kind: r.kind,
      scope: r.scope,
      permissions: r.kind === 'single' ? r.permissions : [],
      members: r.kind === 'composite' ? r.members.map((m) => m.id) : [],
    }),
  );
  if (created) {
    toast('已复制为新角色，可以修改。', 'green');
    await router.push('/settings/roles/' + created.id);
  }
}
const scopeNames: Record<string, string> = {
  all: '全部项目',
  customers: '指定客户的项目',
  projects: '指定项目',
  none: '不含项目',
};
</script>
<template>
  <SettingsPage
    :title="role?.name ?? '角色'"
    :description="
      role
        ? (role.scope === 'project' ? '项目级' : '企业级') +
          (role.kind === 'composite' ? '复合角色' : '单一角色') +
          ' · ' +
          role.code
        : ''
    "
    :back="{ to: '/settings/roles', label: '角色与权限' }"
  >
    <template #actions>
      <BaseButton v-if="role && can('role:manage')" :loading="copy.busy.value" @click="duplicate"
        >复制为新角色</BaseButton
      >
      <BaseButton
        v-if="editable && !role?.inUse"
        variant="danger"
        :loading="removal.busy.value"
        @click="remove"
        >删除</BaseButton
      >
    </template>
    <p v-if="error || copy.error.value || removal.error.value" class="s-error" role="alert">
      {{ error || copy.error.value || removal.error.value }}
    </p>
    <BaseSkeleton v-if="loading && !role" height="240px" />
    <template v-if="role">
      <SettingsCard
        title="角色信息"
        :description="
          role.builtIn ? '系统角色随版本更新，不能修改；需要调整时复制为新角色。' : undefined
        "
        :editable="editable"
        :dirty="dirty"
        :saving="save.busy.value"
        :error="save.error.value"
        @save="submit"
      >
        <SettingsField label="名称" for="r-name">
          <input id="r-name" v-model="name" class="s-input" maxlength="60" :disabled="!editable" />
        </SettingsField>
        <SettingsField label="说明" for="r-desc">
          <textarea
            id="r-desc"
            v-model="description"
            class="s-textarea"
            maxlength="300"
            :disabled="!editable"
          />
        </SettingsField>
        <SettingsField label="状态" help="停用后，持有这个角色的人立即失去它带来的权限。">
          <label class="s-check"
            ><input
              type="checkbox"
              :checked="status === 'active'"
              :disabled="!editable"
              @change="status = status === 'active' ? 'inactive' : 'active'"
            />启用</label
          >
        </SettingsField>
      </SettingsCard>

      <SettingsCard
        v-if="role.kind === 'composite'"
        title="包含的单一角色"
        :description="`合并后共 ${merged.length} 个权限点。`"
        :editable="editable"
        :dirty="dirty"
        :saving="save.busy.value"
        :error="save.error.value"
        @save="submit"
      >
        <div class="member-grid">
          <label v-for="s in singles" :key="s.id" class="s-check member">
            <input v-model="members" type="checkbox" :value="s.id" :disabled="!editable" />
            <span
              ><strong>{{ s.name }}</strong
              ><small>{{ s.description }}</small></span
            >
          </label>
        </div>
      </SettingsCard>
      <SettingsCard
        :title="role.kind === 'composite' ? '合并后的权限点' : '权限点'"
        :description="
          role.kind === 'composite'
            ? '由包含的单一角色决定，只读。'
            : '勾选操作或字段权限时会同时勾选所在分组的查看权限。'
        "
        :editable="editable && role.kind === 'single'"
        :dirty="dirty"
        :saving="save.busy.value"
        :error="save.error.value"
        @save="submit"
      >
        <PermissionTree
          v-if="role.kind === 'single'"
          v-model="permissions"
          :scope="role.scope"
          :readonly="!editable"
        />
        <PermissionTree v-else :model-value="merged" :scope="role.scope" readonly />
      </SettingsCard>

      <SettingsCard
        title="持有人"
        :description="`直接或经由复合角色持有，共 ${role.holders.length} 次分配。`"
        flush
      >
        <div class="s-list">
          <RouterLink
            v-for="h in role.holders"
            :key="h.assignmentId"
            :to="'/settings/users/' + h.userId"
            class="s-list-row"
          >
            <BaseAvatar :name="h.displayName" :size="24" />
            <span class="s-list-main">
              <strong>{{ h.displayName }}</strong>
              <small>{{
                h.level === 'project'
                  ? '项目 · ' + h.projectName
                  : '企业级 · ' + scopeNames[h.projectScope]
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
      </SettingsCard>
      <SettingsCard
        v-if="role.containedIn.length"
        title="包含于"
        description="这些复合角色包含本角色。"
        flush
      >
        <div class="s-list">
          <RouterLink
            v-for="c in role.containedIn"
            :key="c.id"
            :to="'/settings/roles/' + c.id"
            class="s-list-row"
          >
            <span class="s-list-main"
              ><strong>{{ c.name }}</strong
              ><small class="s-mono">{{ c.code }}</small></span
            >
          </RouterLink>
        </div>
      </SettingsCard>
    </template>
  </SettingsPage>
</template>
<style scoped>
.member-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-2);
}
.member {
  align-items: flex-start;
  padding: var(--space-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-8);
}
.member span {
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
.empty-note {
  margin: 0;
  padding: var(--space-4);
  color: var(--text-muted);
}
@media (max-width: 560px) {
  .member-grid {
    grid-template-columns: 1fr;
  }
}
</style>
