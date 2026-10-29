<script setup lang="ts">
import { computed, ref } from 'vue';
import SettingsDrawer from '../settings/SettingsDrawer.vue';
import { useSave } from '../settings/useLoad';
import { accessApi, type Role } from './api';

// Creating a role in the list's drawer (docs/specs/project-access-admin.md 2.5; DESIGN.md 5
// “抽屉”): a code and a name, single or composite, organization or project level; the
// permissions are chosen on the role page afterwards (or copied from an existing role).
const props = defineProps<{ roles: Role[]; copy: Role | null }>();
const emit = defineEmits<{ created: [role: Role]; close: [] }>();
const source0 = props.copy;
const draft = ref(
  source0
    ? {
        code: 'Z_' + source0.code.replace(/^(SYS_|C_|PRJ_|DL_|AG_)/, ''),
        name: source0.name + '（副本）',
        description: source0.description,
        kind: source0.kind as string,
        scope: source0.scope as string,
        copyFrom: source0.id,
      }
    : { code: 'Z_', name: '', description: '', kind: 'single', scope: 'project', copyFrom: '' },
);
const initial = JSON.stringify(draft.value);
const dirty = computed(() => JSON.stringify(draft.value) !== initial);
const save = useSave();
const sources = computed(() =>
  props.roles.filter((r) => r.kind === draft.value.kind && r.scope === draft.value.scope),
);
const ready = computed(() => !!draft.value.name && draft.value.code.length >= 2);
async function submit() {
  if (!ready.value || save.busy.value) return;
  const source = props.roles.find((r) => r.id === draft.value.copyFrom);
  if (draft.value.kind === 'composite' && !source) {
    save.error.value = '复合角色请先选择“复制自”的复合角色，创建后再调整包含的单一角色。';
    return;
  }
  const role = await save.run(() =>
    accessApi.createRole({
      ...draft.value,
      permissions: source?.kind === 'single' ? source.permissions : [],
      members: source?.kind === 'composite' ? source.members.map((m) => m.id) : [],
    }),
  );
  if (role) emit('created', role);
}
defineExpose({ dirty, busy: save.busy });
</script>
<template>
  <SettingsDrawer
    :title="copy ? '复制角色' : '新建角色'"
    description="先确定编码、名称与类型；权限点在角色页中勾选。"
    close-label="关闭新建角色抽屉"
    note="创建后打开角色页"
    :busy="save.busy.value"
    @close="emit('close')"
    @submit="submit"
  >
    <p v-if="save.error.value" class="error-note" role="alert">{{ save.error.value }}</p>
    <p v-if="copy" class="s-drawer-note">
      复制自 {{ copy.name }}（{{ copy.code }}），{{
        copy.kind === 'composite' ? '包含的单一角色' : '权限点'
      }}一并带过来。
    </p>
    <section>
      <h3>基本信息</h3>
      <label class="s-field"
        ><span>编码 <b>*</b></span
        ><input
          v-model="draft.code"
          class="mono"
          maxlength="40"
          placeholder="Z_ 开头便于区分"
          required
          :disabled="save.busy.value"
      /></label>
      <label class="s-field"
        ><span>名称 <b>*</b></span
        ><input v-model="draft.name" maxlength="60" required autofocus :disabled="save.busy.value"
      /></label>
      <label class="s-field top"
        ><span>说明</span
        ><textarea v-model="draft.description" maxlength="300" :disabled="save.busy.value" />
      </label>
    </section>
    <section>
      <h3>类型与来源</h3>
      <label class="s-field"
        ><span>类型</span
        ><select v-model="draft.kind" :disabled="save.busy.value" @change="draft.copyFrom = ''">
          <option value="single">单一角色（一组权限点）</option>
          <option value="composite">复合角色（一组单一角色）</option>
        </select></label
      >
      <label class="s-field"
        ><span>层级</span
        ><select v-model="draft.scope" :disabled="save.busy.value" @change="draft.copyFrom = ''">
          <option value="project">项目级（在项目中分配）</option>
          <option value="organization">企业级（可带项目范围）</option>
        </select></label
      >
      <label class="s-field"
        ><span
          >复制自<template v-if="draft.kind === 'composite'"> <b>*</b></template></span
        ><select v-model="draft.copyFrom" :disabled="save.busy.value">
          <option value="">
            {{ draft.kind === 'composite' ? '选择一个复合角色' : '不复制，从空白开始' }}
          </option>
          <option v-for="r in sources" :key="r.id" :value="r.id">
            {{ r.name }}（{{ r.code }}）
          </option>
        </select></label
      >
      <p class="s-drawer-help">
        {{
          draft.kind === 'composite'
            ? '复合角色从一个已有的复合角色复制，创建后再调整包含的单一角色。'
            : '复制已有单一角色的权限点，或从空白开始，创建后在角色页中勾选。'
        }}
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
        {{ save.busy.value ? '正在处理…' : '创建' }}
      </button>
    </template>
  </SettingsDrawer>
</template>
