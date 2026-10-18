<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import BaseButton from '../../components/base/BaseButton.vue';
import BaseDialog from '../../components/base/BaseDialog.vue';
import BaseTag from '../../components/base/BaseTag.vue';
import { toast } from '../../components/base/toast';
import { askConfirmation } from '../../services/confirmation';
import { currentProject, projects } from '../../services/projectContext';
import SettingsPage from '../settings/SettingsPage.vue';
import SettingsCard from '../settings/SettingsCard.vue';
import { useSave } from '../settings/useLoad';
import ProjectGate from '../projects/ProjectGate.vue';
import { useProject } from '../projects/useProject';
import SapLoginDialog from './SapLoginDialog.vue';
import { credentialLabel, purposeLabel, sapApi, type ProjectSystems, type SapSystem } from './api';
import '../settings/settings.css';

// 项目 → SAP 系统 (docs/specs/project-access-admin.md 3.2–3.3): the project's development and
// test systems (never production, never a password) and the signed-in user's own login to each.
const { project, loading, error, readOnly } = useProject();
const view = ref<ProjectSystems | null>(null);
const listError = ref('');
async function load() {
  if (!project.value) return;
  listError.value = '';
  try {
    view.value = await sapApi.systems(project.value.id);
  } catch (e) {
    listError.value = (e as Error).message;
  }
}
watch(project, load, { immediate: true });
const manage = computed(() => !!view.value?.canManage && !readOnly.value);
const groups = computed(() =>
  (['development', 'test'] as const).map((purpose) => ({
    purpose,
    items: (view.value?.systems ?? []).filter((s) => s.purpose === purpose),
  })),
);

type Draft = {
  id?: string;
  name: string;
  purpose: string;
  sid: string;
  sapUrl: string;
  client: string;
  language: string;
  description: string;
  status: string;
  rowVersion?: string;
};
const editing = ref<Draft | null>(null);
const save = useSave();
function open(s?: SapSystem, purpose = 'development') {
  save.error.value = '';
  editing.value = s
    ? {
        id: s.id,
        name: s.name,
        purpose: s.purpose,
        sid: s.sid,
        sapUrl: s.sapUrl,
        client: s.client,
        language: s.language,
        description: s.description,
        status: s.status,
        rowVersion: s.rowVersion,
      }
    : {
        name: '',
        purpose,
        sid: '',
        sapUrl: 'https://',
        client: '',
        language: project.value?.language ?? 'ZH',
        description: '',
        status: 'active',
      };
}
async function submit() {
  const e = editing.value!;
  const id = project.value!.id;
  const next = await save.run(() => (e.id ? sapApi.update(id, e.id, e) : sapApi.create(id, e)));
  if (next) {
    view.value = next;
    editing.value = null;
    toast('SAP 系统已保存。', 'green');
  }
}
async function remove() {
  const e = editing.value!;
  if (
    !(await askConfirmation(
      `删除 ${e.name}？所有人在该系统保存的凭据会一并删除；指向它的开发项改用默认开发系统。`,
    ))
  )
    return;
  const next = await save.run(() => sapApi.remove(project.value!.id, e.id!, e.rowVersion!));
  if (next) {
    view.value = next;
    editing.value = null;
  }
}
const action = useSave();
async function makeDefault(s: SapSystem) {
  const next = await action.run(() => sapApi.makeDefault(project.value!.id, s.id));
  if (next) view.value = next;
}
const testing = ref('');
async function test(s: SapSystem) {
  testing.value = s.id;
  const result = await action.run(() => sapApi.test(project.value!.id, s.id));
  testing.value = '';
  if (result)
    toast(
      result.status === 'passed'
        ? '连接正常：' + (result.version ?? '')
        : '连接失败：' + result.message,
      result.status === 'passed' ? 'green' : 'red',
    );
  await load();
}
async function logout(s: SapSystem) {
  const next = await action.run(() => sapApi.logout(project.value!.id, s.id));
  if (next) view.value = next;
}
const loginOpen = ref(false);
const loginSystem = ref<SapSystem | null>(null);
function login(s: SapSystem) {
  loginSystem.value = s;
  loginOpen.value = true;
}
function loggedIn(next: ProjectSystems) {
  view.value = next;
  toast('已登录 ' + (loginSystem.value?.name ?? 'SAP'), 'green');
}

const copying = ref(false);
const source = ref('');
const siblings = computed(() =>
  projects.value.filter(
    (p) => p.id !== currentProject.value && p.customerName === project.value?.customerName,
  ),
);
async function copy() {
  const next = await action.run(() => sapApi.copy(project.value!.id, source.value));
  if (next) {
    view.value = next;
    copying.value = false;
    toast(`已复制 ${next.copied} 个系统。`, 'green');
  }
}
const testTone = (s: SapSystem) =>
  s.testStatus === 'passed' ? 'green' : s.testStatus ? 'red' : 'neutral';
</script>
<template>
  <SettingsPage
    title="SAP 系统"
    description="项目使用的开发与测试系统（不登记生产系统）。这里不保存任何账号：每个人用自己的 SAP 用户登录。"
    wide
  >
    <template #actions>
      <BaseButton v-if="manage && siblings.length" @click="copying = true"
        >从其他项目复制</BaseButton
      >
      <BaseButton v-if="manage" variant="primary" @click="open()">登记系统</BaseButton>
    </template>
    <ProjectGate
      :loading="loading"
      :error="error || listError"
      :ready="!!view"
      :archived="readOnly"
    >
      <p v-if="action.error.value" class="s-error" role="alert">{{ action.error.value }}</p>
      <SettingsCard
        v-for="g in groups"
        :key="g.purpose"
        :title="purposeLabel(g.purpose)"
        :description="
          g.purpose === 'development'
            ? '开发助手默认使用开发项的目标系统或默认开发系统。'
            : '设计助手默认使用默认测试系统；测试数据只建在测试系统。'
        "
        flush
      >
        <template #headerActions>
          <BaseButton v-if="manage" size="sm" @click="open(undefined, g.purpose)">新增</BaseButton>
        </template>
        <div class="s-list">
          <div v-for="s in g.items" :key="s.id" class="s-list-row system">
            <span class="sid">{{ s.sid }}</span>
            <span class="s-list-main">
              <strong
                >{{ s.name }}<BaseTag v-if="s.isDefault" tone="blue">默认</BaseTag
                ><BaseTag v-if="s.status === 'inactive'" strike>停用</BaseTag></strong
              >
              <small
                >client {{ s.client }} · {{ s.sapUrl }} · {{ s.language
                }}{{ s.description ? ' · ' + s.description : '' }}</small
              >
              <small v-if="s.testedAt" class="tested"
                ><BaseTag :tone="testTone(s)">{{
                  s.testStatus === 'passed' ? '连接正常' : '连接失败'
                }}</BaseTag
                >{{ s.backendVersion || s.testMessage }} ·
                {{ s.testedAt.slice(0, 16).replace('T', ' ') }}</small
              >
            </span>
            <span class="s-list-side actions">
              <template v-if="s.canRead && s.status === 'active'">
                <BaseTag :tone="s.credential?.state === 'none' ? 'neutral' : 'green'"
                  >{{ credentialLabel[s.credential?.state ?? 'none']
                  }}{{ s.credential?.username ? ' · ' + s.credential.username : '' }}</BaseTag
                >
                <BaseButton
                  v-if="s.credential?.state === 'session' || s.credential?.state === 'saved'"
                  size="sm"
                  variant="ghost"
                  @click="logout(s)"
                  >退出</BaseButton
                >
                <BaseButton v-else size="sm" @click="login(s)">登录</BaseButton>
                <BaseButton
                  size="sm"
                  variant="ghost"
                  :loading="testing === s.id"
                  :disabled="s.credential?.state === 'none'"
                  @click="test(s)"
                  >测试连接</BaseButton
                >
              </template>
              <BaseButton
                v-if="manage && !s.isDefault && s.status === 'active'"
                size="sm"
                variant="ghost"
                @click="makeDefault(s)"
                >设为默认</BaseButton
              >
              <BaseButton v-if="manage" size="sm" variant="ghost" @click="open(s)">编辑</BaseButton>
            </span>
          </div>
          <p v-if="!g.items.length" class="empty-note">
            还没有登记{{ purposeLabel(g.purpose) }}。{{
              manage ? '' : '请联系项目经理或 Basis 顾问登记。'
            }}
          </p>
        </div>
      </SettingsCard>
      <p v-if="view" class="s-note">
        你的 SAP 凭据只用于你本人发起的请求；保存期限 {{ view.policy.maxDays }} 天、闲置
        {{ view.policy.idleDays }} 天失效。全部凭据可在“设置 → 我的 SAP 凭据”中查看与删除。
      </p>
    </ProjectGate>

    <SapLoginDialog
      v-if="view"
      v-model:open="loginOpen"
      :project-id="view.projectId"
      :system="loginSystem"
      :can-save="view.canSave"
      :policy="view.policy"
      :profile-login="view.profileLogin"
      @saved="loggedIn"
    />

    <BaseDialog
      :open="!!editing"
      :title="editing?.id ? '编辑 SAP 系统' : '登记 SAP 系统'"
      description="只登记地址与 Client，不保存用户和密码。修改地址或 Client 后，所有人在该系统保存的凭据自动失效。"
      wide
      @update:open="(v) => !v && (editing = null)"
    >
      <form v-if="editing" class="dialog-form" @submit.prevent="submit">
        <div class="s-grid-2">
          <label
            >名称<input
              v-model="editing.name"
              class="s-input"
              maxlength="60"
              placeholder="如 S/4 开发 100"
              required
          /></label>
          <label
            >用途<select v-model="editing.purpose" class="s-select" :disabled="!!editing.id">
              <option value="development">开发系统</option>
              <option value="test">测试系统</option>
            </select></label
          >
          <label
            >系统标识 SID<input
              v-model="editing.sid"
              class="s-input mono"
              maxlength="3"
              placeholder="S4D"
              required
          /></label>
          <label
            >Client<input
              v-model="editing.client"
              class="s-input mono"
              maxlength="3"
              placeholder="100"
              required
          /></label>
        </div>
        <label
          >ADT 地址<input
            v-model="editing.sapUrl"
            class="s-input mono"
            maxlength="2048"
            placeholder="https://host:44300"
            required
        /></label>
        <div class="s-grid-2">
          <label
            >登录语言<input v-model="editing.language" class="s-input mono" maxlength="2"
          /></label>
          <label
            >状态<select v-model="editing.status" class="s-select">
              <option value="active">启用</option>
              <option value="inactive">停用（助手不可选，历史保留）</option>
            </select></label
          >
        </div>
        <label
          >说明<input
            v-model="editing.description"
            class="s-input"
            maxlength="300"
            placeholder="如 FI 沙箱，数据每周刷新"
        /></label>
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
          :disabled="!editing?.name || !editing?.sid || !editing?.client"
          @click="submit"
          >保存</BaseButton
        >
      </template>
    </BaseDialog>

    <BaseDialog
      v-model:open="copying"
      title="从其他项目复制"
      description="复制同一客户其他项目登记的系统；已登记的相同系统会跳过。"
    >
      <label class="copy-field"
        >来源项目<select v-model="source" class="s-select">
          <option value="" disabled>选择项目</option>
          <option v-for="p in siblings" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select></label
      >
      <template #footer>
        <BaseButton @click="copying = false">取消</BaseButton>
        <BaseButton variant="primary" :loading="action.busy.value" :disabled="!source" @click="copy"
          >复制</BaseButton
        >
      </template>
    </BaseDialog>
  </SettingsPage>
</template>
<style scoped>
.system {
  align-items: flex-start;
}
.sid {
  display: grid;
  place-items: center;
  width: 40px;
  height: 32px;
  flex-shrink: 0;
  border-radius: var(--radius-6);
  background: var(--neutral-fill-1);
  font-family: var(--font-mono);
  font-size: var(--font-12);
  font-weight: var(--weight-550);
}
.s-list-main strong {
  display: flex;
  align-items: center;
  gap: var(--space-1-5);
}
.tested {
  display: flex;
  align-items: center;
  gap: var(--space-1-5);
}
.actions {
  max-width: 50%;
}
.empty-note {
  margin: 0;
  padding: var(--space-4);
  color: var(--text-muted);
}
.dialog-form {
  display: grid;
  gap: var(--space-3);
}
.dialog-form label,
.copy-field {
  display: grid;
  gap: var(--space-1);
  color: var(--text-muted);
  font-size: var(--font-12);
}
.left {
  margin-right: auto;
}
@media (max-width: 760px) {
  .system {
    flex-wrap: wrap;
  }
  .actions {
    max-width: none;
    width: 100%;
    justify-content: flex-start;
  }
}
</style>
