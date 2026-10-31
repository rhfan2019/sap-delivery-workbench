<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  KeyRound,
  MinusCircle,
  Plus,
  RefreshCw,
  Search,
  Server,
  Star,
  Trash2,
  XCircle,
} from '@lucide/vue';
import BaseButton from '../../components/base/BaseButton.vue';
import BaseDialog from '../../components/base/BaseDialog.vue';
import { toast } from '../../components/base/toast';
import { askConfirmation } from '../../services/confirmation';
import { currentProject, projects } from '../../services/projectContext';
import SettingsPage from '../settings/SettingsPage.vue';
import SettingsRowMenu from '../settings/SettingsRowMenu.vue';
import { useDrawerLeave } from '../settings/useDrawerLeave';
import { useSave } from '../settings/useLoad';
import ProjectGate from '../projects/ProjectGate.vue';
import { useProject } from '../projects/useProject';
import SapLoginDialog from './SapLoginDialog.vue';
import SapSystemDrawer from './SapSystemDrawer.vue';
import { credentialLabel, purposeLabel, sapApi, type ProjectSystems, type SapSystem } from './api';
import '../settings/settings.css';

// 项目 → SAP 系统 (docs/specs/project-access-admin.md 3.2–3.3, 4.4): the project's development and
// test systems (never production, never a password) and the signed-in user's own login to each,
// as a settings list with its drawer like 大模型 (DESIGN.md 6.2).
const { project, loading, error, readOnly } = useProject();
const view = ref<ProjectSystems | null>(null);
const listError = ref('');
const refreshing = ref(false);
async function load() {
  if (!project.value) return;
  listError.value = '';
  refreshing.value = true;
  try {
    view.value = await sapApi.systems(project.value.id);
  } catch (e) {
    listError.value = (e as Error).message;
  } finally {
    refreshing.value = false;
  }
}
watch(project, load, { immediate: true });
const manage = computed(() => !!view.value?.canManage && !readOnly.value);
const systems = computed(() => view.value?.systems ?? []);
const defaultOf = (purpose: string) =>
  systems.value.find((s) => s.purpose === purpose && s.isDefault)?.name ?? '尚未设置';

const query = ref('');
const purpose = ref('');
const page = ref(1);
const filtered = computed(() =>
  systems.value.filter(
    (s) =>
      (!purpose.value || s.purpose === purpose.value) &&
      (s.name + ' ' + s.sid + ' ' + s.sapUrl + ' ' + s.description)
        .toLowerCase()
        .includes(query.value.trim().toLowerCase()),
  ),
);
const pages = computed(() => Math.max(1, Math.ceil(filtered.value.length / 10)));
const rows = computed(() => filtered.value.slice((page.value - 1) * 10, page.value * 10));
watch([query, purpose], () => (page.value = 1));
watch(pages, (n) => (page.value = Math.min(n, page.value)));

// The drawer: one system at a time; another row or “登记系统” asks before dropping changes.
// A row opens it to read, its 编辑 straight to edit (development-discipline.md 4.1).
const open = ref(false);
const editing = ref<SapSystem | null>(null);
const editNow = ref(false);
const revision = ref(0);
const drawer = ref<InstanceType<typeof SapSystemDrawer> | null>(null);
async function canLeave() {
  if (drawer.value?.busy) return false;
  return !drawer.value?.dirty || (await askConfirmation('放弃尚未保存的 SAP 系统修改？'));
}
async function edit(s: SapSystem | null, now = !s) {
  if (now && !manage.value) return;
  if (open.value && s && editing.value?.id === s.id) {
    if (now) drawer.value?.startEdit();
    return;
  }
  if (open.value && !(await canLeave())) return;
  editing.value = s;
  editNow.value = now;
  open.value = true;
}
async function close() {
  if (await canLeave()) {
    open.value = false;
    editing.value = null;
  }
}
useDrawerLeave(canLeave, () => !!drawer.value?.dirty);
// After saving, the drawer reads the saved system.
function saved(next: ProjectSystems) {
  const before = new Set(systems.value.map((s) => s.id));
  view.value = next;
  editing.value =
    systems.value.find((s) => (editing.value ? s.id === editing.value.id : !before.has(s.id))) ??
    null;
  editNow.value = false;
  revision.value++;
  if (!editing.value) open.value = false;
  toast('SAP 系统已保存。', 'green');
}

const action = useSave();
async function remove(s: SapSystem) {
  if (
    !(await askConfirmation(
      `删除 ${s.name}？所有人在该系统保存的凭据会一并删除；指向它的开发项改用默认开发系统。`,
    ))
  )
    return;
  const next = await action.run(() => sapApi.remove(project.value!.id, s.id, s.rowVersion));
  if (next) {
    view.value = next;
    if (editing.value?.id === s.id) {
      open.value = false;
      editing.value = null;
    }
    toast('SAP 系统已删除。', 'green');
  }
}
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

const usable = (s: SapSystem) => !!s.canRead && s.status === 'active';
const signedIn = (s: SapSystem) =>
  s.credential?.state === 'session' || s.credential?.state === 'saved';
const loginText = (s: SapSystem) =>
  credentialLabel[s.credential?.state ?? 'none'] +
  (s.credential?.username ? ' · ' + s.credential.username : '');
const testState = (s: SapSystem) =>
  !s.testedAt ? 'untested' : s.testStatus === 'passed' ? 'passed' : 'failed';
const testIcon = (s: SapSystem) =>
  ({ untested: MinusCircle, passed: CheckCircle2, failed: XCircle })[testState(s)];
const rowMenu = (s: SapSystem) => [
  {
    label: '设为默认',
    icon: Star,
    disabled: action.busy.value || s.isDefault || s.status !== 'active',
    title: s.status !== 'active' ? '停用的系统不能设为默认' : '',
    run: () => makeDefault(s),
  },
  { label: '删除', icon: Trash2, danger: true, disabled: action.busy.value, run: () => remove(s) },
];
</script>
<template>
  <SettingsPage
    title="SAP 系统"
    description="项目使用的开发与测试系统（不登记生产系统）。这里不保存任何账号：每个人用自己的 SAP 用户登录。"
    list
    :drawer="open"
  >
    <template #actions>
      <button
        class="icon-button"
        aria-label="刷新 SAP 系统列表"
        :disabled="refreshing || !project"
        @click="load"
      >
        <RefreshCw :size="18" />
      </button>
    </template>
    <ProjectGate
      :loading="loading"
      :error="error || listError"
      :ready="!!view"
      :archived="readOnly"
    >
      <p v-if="action.error.value" class="s-error" role="alert">{{ action.error.value }}</p>
      <p class="s-summary">
        默认开发系统：<strong>{{ defaultOf('development') }}</strong
        >默认测试系统：<strong>{{ defaultOf('test') }}</strong
        ><span>· 开发助手默认用开发系统，测试数据只建在测试系统</span>
      </p>
      <div class="s-table-toolbar">
        <label class="s-table-search"
          ><Search :size="17" /><input
            v-model="query"
            aria-label="搜索 SAP 系统"
            placeholder="搜索名称、SID 或地址" /></label
        ><select v-model="purpose" aria-label="筛选用途">
          <option value="">全部用途</option>
          <option value="development">开发系统</option>
          <option value="test">测试系统</option>
        </select>
        <div v-if="manage" class="s-table-actions">
          <button v-if="siblings.length" class="secondary-button" @click="copying = true">
            从其他项目复制
          </button>
          <button class="primary-button" @click="edit(null)"><Plus :size="17" />登记系统</button>
        </div>
      </div>
      <div class="s-table-surface">
        <div v-if="!rows.length" class="s-table-empty">
          <Server :size="32" />
          <h2>{{ query || purpose ? '没有匹配的系统' : '还没有登记 SAP 系统' }}</h2>
          <p>
            {{
              query || purpose
                ? '调整搜索或筛选条件后再试。'
                : manage
                  ? '登记项目的开发与测试系统后，助手才能连接 SAP。'
                  : '请联系项目经理或 Basis 顾问登记。'
            }}
          </p>
        </div>
        <table v-else class="s-table">
          <thead>
            <tr>
              <th class="default-col">默认</th>
              <th>系统</th>
              <th class="hide-narrow">用途</th>
              <th>我的登录</th>
              <th>最近测试</th>
              <th class="actions-col sap-actions">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="s in rows"
              :key="s.id"
              class="clickable"
              :class="{ selected: open && editing?.id === s.id }"
              @click="edit(s)"
            >
              <td @click.stop>
                <button
                  class="s-star"
                  :class="{ active: s.isDefault }"
                  :aria-label="
                    s.isDefault
                      ? '当前默认' + purposeLabel(s.purpose) + '：' + s.name
                      : '设为默认：' + s.name
                  "
                  :aria-pressed="s.isDefault"
                  :disabled="!manage || s.isDefault || s.status !== 'active' || action.busy.value"
                  :title="
                    s.isDefault
                      ? '当前默认' + purposeLabel(s.purpose)
                      : s.status !== 'active'
                        ? '停用的系统不能设为默认'
                        : '设为默认' + purposeLabel(s.purpose)
                  "
                  @click.stop="makeDefault(s)"
                >
                  <Star :size="21" :fill="s.isDefault ? 'currentColor' : 'none'" />
                </button>
              </td>
              <td>
                <button class="s-table-name" @click.stop="edit(s)">
                  {{ s.name }}</button
                ><span v-if="s.isDefault" class="s-badge">默认</span
                ><span v-if="s.status === 'inactive'" class="s-badge muted">停用</span>
                <small class="mono">{{ s.sid }} · client {{ s.client }} · {{ s.language }}</small>
                <small v-if="s.description">{{ s.description }}</small>
              </td>
              <td class="hide-narrow">
                <span>{{ purposeLabel(s.purpose) }}</span
                ><small class="mono">{{ s.sapUrl }}</small>
              </td>
              <td>
                <template v-if="usable(s)">
                  <span
                    class="s-state"
                    :class="s.credential?.state === 'none' ? 'untested' : 'passed'"
                    ><KeyRound :size="17" />{{ loginText(s) }}</span
                  >
                </template>
                <span v-else class="s-state untested">{{
                  s.status === 'active' ? '无权使用' : '已停用'
                }}</span>
              </td>
              <td>
                <span class="s-state" :class="testState(s)"
                  ><component :is="testIcon(s)" :size="17" />{{
                    testState(s) === 'untested'
                      ? '未测试'
                      : testState(s) === 'passed'
                        ? '连接正常'
                        : '连接失败'
                  }}</span
                ><small v-if="s.testedAt" :title="s.testMessage ?? ''"
                  >{{ s.testedAt.slice(5, 16).replace('T', ' ') }} ·
                  {{ s.backendVersion || s.testMessage }}</small
                >
              </td>
              <td>
                <div class="s-row-actions" @click.stop>
                  <button v-if="manage" class="text-button" @click.stop="edit(s, true)">
                    编辑
                  </button>
                  <template v-if="usable(s)">
                    <button
                      v-if="signedIn(s)"
                      class="text-button"
                      :disabled="action.busy.value"
                      @click="logout(s)"
                    >
                      退出</button
                    ><button v-else class="text-button" @click="login(s)">登录</button
                    ><button
                      class="text-button"
                      :disabled="s.credential?.state === 'none' || action.busy.value"
                      @click="test(s)"
                    >
                      {{ testing === s.id ? '测试中' : '测试' }}
                    </button>
                  </template>
                  <SettingsRowMenu
                    v-if="manage"
                    :label="s.name + '的更多操作'"
                    :items="rowMenu(s)"
                  />
                </div>
              </td>
            </tr>
          </tbody>
        </table>
        <footer class="s-table-footer">
          <span>共 {{ filtered.length }} 个系统</span>
          <div>
            <button class="icon-button" aria-label="上一页" :disabled="page === 1" @click="page--">
              <ChevronLeft :size="17" /></button
            ><span>{{ page }} / {{ pages }}</span
            ><button
              class="icon-button"
              aria-label="下一页"
              :disabled="page === pages"
              @click="page++"
            >
              <ChevronRight :size="17" />
            </button>
          </div>
        </footer>
      </div>
      <p v-if="view" class="s-table-note">
        你的 SAP 凭据只用于你本人发起的请求；保存期限 {{ view.policy.maxDays }} 天、闲置
        {{ view.policy.idleDays }} 天失效。全部凭据可在“设置 → 我的 SAP 凭据”中查看与删除。
      </p>
    </ProjectGate>

    <SapSystemDrawer
      v-if="project && open"
      ref="drawer"
      :key="(editing?.id ?? 'new') + '/' + revision"
      :project-id="project.id"
      :system="editing"
      :editable="manage"
      :edit="editNow"
      :purpose="purpose === 'test' ? 'test' : 'development'"
      :language="project.language ?? 'ZH'"
      @saved="saved"
      @close="close"
    />

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
.s-table .sap-actions {
  width: 220px;
}
.copy-field {
  display: grid;
  gap: var(--space-1);
  color: var(--text-muted);
  font-size: var(--font-12);
}
</style>
