<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  PERSON_TYPES,
  SENSITIVE_PERMISSIONS,
} from '@sap-delivery-workbench/contracts/access/catalog';
import BaseTag from '../../components/base/BaseTag.vue';
import ChoiceChips from '../settings/ChoiceChips.vue';
import SettingsDrawer from '../settings/SettingsDrawer.vue';
import { useSave } from '../settings/useLoad';
import { accessApi, day, type Candidate, type Member, type Role } from './api';

// Adding a member or changing a member's project roles in the list's drawer
// (docs/specs/project-access-admin.md 2.4, 4.4; DESIGN.md 5 “抽屉”): pick roles as cards (Plain's
// role picker), then the module scope, “own items only” and the validity they share.
const props = defineProps<{
  projectId: string;
  roles: Role[];
  modules: string[];
  member: Member | null;
  candidates: Candidate[];
  canSensitive: (code: string) => boolean;
}>();
const emit = defineEmits<{ saved: [members: Member[]]; close: [] }>();

const first = props.member?.roles[0];
const userId = ref('');
const chosen = ref<string[]>(props.member?.roles.map((r) => r.roleId) ?? []);
const modules = ref<string[]>(first?.modules ?? []);
const ownOnly = ref(first?.ownOnly ?? false);
const validFrom = ref(day(first?.validFrom));
const validTo = ref(day(first?.validTo));
const save = useSave();
const projectRoles = computed(() =>
  props.roles.filter((r) => r.scope === 'project' && r.status === 'active'),
);
const composites = computed(() => projectRoles.value.filter((r) => r.kind === 'composite'));
const singles = computed(() => projectRoles.value.filter((r) => r.kind === 'single'));
const showSingles = ref(chosen.value.some((id) => singles.value.some((s) => s.id === id)));
const candidate = computed(() => props.candidates.find((c) => c.id === userId.value));
const person = computed(
  () => props.member?.personType ?? candidate.value?.personType ?? 'employee',
);
const differing = computed(() => {
  const roles = props.member?.roles ?? [];
  return (
    new Set(roles.map((r) => JSON.stringify([r.modules, r.ownOnly, r.validFrom, r.validTo]))).size >
    1
  );
});
const snapshot = () =>
  JSON.stringify([
    userId.value,
    [...chosen.value].sort(),
    [...modules.value].sort(),
    ownOnly.value,
    validFrom.value,
    validTo.value,
  ]);
const initial = snapshot();
const dirty = computed(() => snapshot() !== initial);
// A new member starts from their position's default roles and their skill modules.
watch(userId, () => {
  const c = candidate.value;
  if (!c || props.member) return;
  chosen.value = [...c.defaultRoleIds];
  const known = props.modules;
  modules.value = c.skillModules.filter((m) => !known.length || known.includes(m));
  ownOnly.value = c.personType !== 'employee';
});
function toggle(id: string) {
  chosen.value = chosen.value.includes(id)
    ? chosen.value.filter((x) => x !== id)
    : [...chosen.value, id];
}
const blocked = (role: Role) =>
  role.permissions.some((c) => SENSITIVE_PERMISSIONS.includes(c) && !props.canSensitive(c));
const needsEnd = computed(() => person.value !== 'employee' && !validTo.value);
const ready = computed(
  () => (props.member || userId.value) && chosen.value.length > 0 && !needsEnd.value,
);
async function submit() {
  if (!ready.value || save.busy.value) return;
  const roles = chosen.value.map((roleId) => ({
    roleId,
    modules: modules.value,
    ownOnly: ownOnly.value,
    validFrom: validFrom.value || undefined,
    validTo: validTo.value || null,
  }));
  const members = await save.run(() =>
    props.member
      ? accessApi.setRoles(props.projectId, props.member.id, roles)
      : accessApi.addMember(props.projectId, { userId: userId.value, roles }),
  );
  if (members) emit('saved', members);
}
const moduleOptions = computed(() => props.modules.map((m) => ({ value: m, label: m })));
defineExpose({ dirty, busy: save.busy });
</script>
<template>
  <SettingsDrawer
    :title="member ? '调整项目角色' : '添加成员'"
    description="角色决定能做什么；模块范围与“仅本人负责”决定在哪些开发项上做。"
    close-label="关闭成员抽屉"
    note="保存后立即生效"
    :busy="save.busy.value"
    @close="emit('close')"
    @submit="submit"
  >
    <p v-if="save.error.value" class="error-note" role="alert">{{ save.error.value }}</p>
    <section>
      <h3>成员</h3>
      <label v-if="!member" class="s-field"
        ><span>成员 <b>*</b></span
        ><select v-model="userId" required>
          <option value="" disabled>选择企业内的用户</option>
          <option v-for="c in candidates" :key="c.id" :value="c.id">
            {{ c.displayName }}（{{ c.loginName }}）{{ c.positionName ? ' · ' + c.positionName : ''
            }}{{
              c.personType !== 'employee' ? ' · ' + PERSON_TYPES[c.personType as 'employee'] : ''
            }}
          </option>
        </select></label
      >
      <p v-if="!member && !candidates.length" class="s-drawer-help">
        企业内所有有效用户都已是项目成员。
      </p>
      <div v-if="member" class="s-field">
        <span>成员</span>
        <span
          >{{ member.displayName }}
          <small class="member-sub"
            >{{ member.positionName ?? '未设职位' }} · {{ member.loginName
            }}<template v-if="member.personType !== 'employee'">
              · {{ PERSON_TYPES[member.personType as 'employee'] }}</template
            ></small
          ></span
        >
      </div>
    </section>

    <section>
      <h3>角色 <b class="required">*</b></h3>
      <div class="role-cards" role="group" aria-label="项目角色">
        <button
          v-for="r in composites"
          :key="r.id"
          type="button"
          class="role-card"
          :aria-pressed="chosen.includes(r.id)"
          :disabled="blocked(r) && !chosen.includes(r.id)"
          @click="toggle(r.id)"
        >
          <strong
            >{{ r.name }}<BaseTag v-if="!r.builtIn" tone="purple">自定义</BaseTag
            ><BaseTag v-if="blocked(r)" tone="yellow">含敏感权限</BaseTag></strong
          >
          <small>{{ r.description || r.members.map((m) => m.name).join('、') }}</small>
        </button>
      </div>
      <button type="button" class="text-button more" @click="showSingles = !showSingles">
        {{ showSingles ? '收起单一角色' : '补充单一角色（' + singles.length + '）' }}
      </button>
      <div v-if="showSingles" class="role-cards compact">
        <button
          v-for="r in singles"
          :key="r.id"
          type="button"
          class="role-card"
          :aria-pressed="chosen.includes(r.id)"
          :disabled="blocked(r) && !chosen.includes(r.id)"
          @click="toggle(r.id)"
        >
          <strong>{{ r.name }}</strong>
          <small>{{ r.description }}</small>
        </button>
      </div>
      <p class="s-drawer-help">
        含敏感权限（成员管理、商务、归档）的角色，只有自己在本项目持有这些权限的人才能分配。
      </p>
    </section>

    <section>
      <h3>范围与期限</h3>
      <div class="s-field top">
        <span>模块范围</span>
        <ChoiceChips
          v-if="moduleOptions.length"
          v-model="modules"
          :options="moduleOptions"
          label="模块范围"
        />
        <span v-else class="member-sub">全部模块</span>
      </div>
      <p class="s-drawer-help">
        {{
          moduleOptions.length
            ? '不选即全部模块。选定后，其他模块的开发项可看不可改。'
            : '项目还没有登记实施模块，范围为全部模块。'
        }}
      </p>
      <label class="s-check"
        ><input
          v-model="ownOnly"
          type="checkbox"
        />仅本人负责：只能修改自己负责的开发项，只能在自己负责的阶段使用助手</label
      >
      <label class="s-field"><span>开始日期</span><input v-model="validFrom" type="date" /></label>
      <label class="s-field"
        ><span
          >结束日期<template v-if="person !== 'employee'"> <b>*</b></template></span
        ><input v-model="validTo" type="date" :required="person !== 'employee'"
      /></label>
      <p v-if="needsEnd" class="s-drawer-help">
        分包与外部人员的角色必须设结束日期，到期自动失效。
      </p>
      <p v-if="differing" class="s-drawer-help">
        该成员各角色的范围不同；保存后所有角色使用这里的范围。
      </p>
    </section>
    <template #actions>
      <button
        type="button"
        class="secondary-button"
        :disabled="save.busy.value"
        @click="emit('close')"
      >
        取消</button
      ><button class="primary-button" :disabled="save.busy.value || !ready">
        {{ save.busy.value ? '正在处理…' : member ? '保存' : '添加' }}
      </button>
    </template>
  </SettingsDrawer>
</template>
<style scoped>
.required {
  color: var(--red-text-2);
}
.member-sub {
  display: block;
  margin-top: var(--space-1);
  color: var(--text-muted);
  font-size: var(--font-12);
}
.role-cards {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-2);
}
.role-card {
  display: grid;
  gap: var(--space-0-5);
  padding: var(--space-2-5) var(--space-3);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-8);
  background: var(--panel);
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition:
    background var(--motion-fast),
    border-color var(--motion-fast);
}
.role-card:hover:not(:disabled) {
  background: var(--hover);
}
.role-card[aria-pressed='true'] {
  border-color: var(--blue-border-3);
  background: var(--blue-bg-2);
  box-shadow: inset 0 0 0 1px var(--blue-border-3);
}
.role-card:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
.role-card:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--focus);
}
.role-card strong {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1-5);
  font-weight: var(--weight-550);
}
.role-card small {
  color: var(--text-muted);
  font-size: var(--font-12);
  line-height: var(--leading-16);
}
.compact .role-card {
  padding: var(--space-2) var(--space-3);
}
.compact {
  margin-top: var(--space-2);
}
.more {
  margin-top: var(--space-3);
}
@media (max-width: 560px) {
  .role-cards {
    grid-template-columns: 1fr;
  }
}
</style>
