<script setup lang="ts">
import { computed, ref } from 'vue';
import { PERSON_TYPES } from '@sap-delivery-workbench/contracts/access/catalog';
import { SAP_MODULES } from '@sap-delivery-workbench/contracts/projects/options';
import ChoiceChips from '../settings/ChoiceChips.vue';
import SettingsDrawer from '../settings/SettingsDrawer.vue';
import { useSave } from '../settings/useLoad';
import type { Position } from '../access/api';
import { adminApi, type AdminUser } from './api';

// Creating a user in the list's drawer (DESIGN.md 5 “抽屉”): the account, its person type, and
// optionally a position whose organization roles come with it; the rest is on the user page.
const props = defineProps<{ positions: Position[] }>();
const emit = defineEmits<{
  created: [result: { user: AdminUser; temporaryPassword: string; granted: string[] }];
  close: [];
}>();
const draft = ref({
  loginName: '',
  displayName: '',
  email: '',
  personType: 'employee',
  positionId: '',
  grantPositionRoles: true,
  skillModules: [] as string[],
});
const initial = JSON.stringify(draft.value);
const dirty = computed(() => JSON.stringify(draft.value) !== initial);
const save = useSave();
const position = computed(() => props.positions.find((p) => p.id === draft.value.positionId));
const orgRoles = computed(
  () => position.value?.roles.filter((r) => r.scope === 'organization') ?? [],
);
const moduleOptions = SAP_MODULES.map((m) => ({ value: m, label: m }));
const ready = computed(() => !!draft.value.loginName && !!draft.value.displayName);
async function submit() {
  if (!ready.value || save.busy.value) return;
  const result = await save.run(() =>
    adminApi.createUser({
      ...draft.value,
      positionId: draft.value.positionId || null,
      grantPositionRoles: draft.value.personType === 'employee' && draft.value.grantPositionRoles,
    }),
  );
  if (result) emit('created', result);
}
defineExpose({ dirty, busy: save.busy });
</script>
<template>
  <SettingsDrawer
    title="新建用户"
    description="创建后生成一次性临时密码；首次登录必须修改。"
    close-label="关闭新建用户抽屉"
    note="临时密码只显示一次"
    :busy="save.busy.value"
    @close="emit('close')"
    @submit="submit"
  >
    <p v-if="save.error.value" class="error-note" role="alert">{{ save.error.value }}</p>
    <section>
      <h3>账号</h3>
      <label class="s-field"
        ><span>登录账号 <b>*</b></span
        ><input
          v-model="draft.loginName"
          class="mono"
          maxlength="64"
          placeholder="英文字母、数字、点、下划线或连字符"
          required
          autofocus
          :disabled="save.busy.value"
      /></label>
      <p class="s-drawer-help">3–64 位英文字母、数字、点、下划线或连字符。</p>
      <label class="s-field"
        ><span>姓名 <b>*</b></span
        ><input v-model="draft.displayName" maxlength="100" required :disabled="save.busy.value"
      /></label>
      <label class="s-field"
        ><span>邮箱</span
        ><input v-model="draft.email" type="email" maxlength="254" :disabled="save.busy.value"
      /></label>
      <label class="s-field"
        ><span>人员类型</span
        ><select v-model="draft.personType" :disabled="save.busy.value">
          <option v-for="(label, key) in PERSON_TYPES" :key="key" :value="key">
            {{ label }}
          </option>
        </select></label
      >
    </section>
    <section>
      <h3>职位与模块</h3>
      <label class="s-field"
        ><span>职位</span
        ><select v-model="draft.positionId" :disabled="save.busy.value">
          <option value="">暂不设置</option>
          <option v-for="p in positions" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select></label
      >
      <label v-if="orgRoles.length" class="s-check"
        ><input
          v-model="draft.grantPositionRoles"
          type="checkbox"
          :disabled="draft.personType !== 'employee' || save.busy.value"
        />同时授予职位的企业级角色：{{ orgRoles.map((r) => r.name).join('、') }}</label
      >
      <div class="s-field top">
        <span>擅长模块</span>
        <ChoiceChips v-model="draft.skillModules" :options="moduleOptions" label="擅长模块" />
      </div>
      <p class="s-drawer-help">加入项目时用作默认的模块范围。</p>
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
        {{ save.busy.value ? '正在处理…' : '创建' }}
      </button>
    </template>
  </SettingsDrawer>
</template>
