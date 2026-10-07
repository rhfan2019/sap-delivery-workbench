<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppIcon from '../../components/AppIcon.vue';
import { identity, ApiError } from '../../services/session';
import { useAdminData } from './useAdminData';
import { adminApi } from './api';
import { displayDate, type AdminUser, type ProjectMember } from './types';
import RelationTree from './components/RelationTree.vue';
import UserEditor from './components/UserEditor.vue';
import AdminDialog from './components/AdminDialog.vue';
import MemberAssignment from './components/MemberAssignment.vue';
const route = useRoute(),
  router = useRouter();
const { organization, customers, projects, loading, error, load } = useAdminData();
const tab = ref(
  ['account', 'member', 'project'].includes(String(route.query.tab))
    ? String(route.query.tab)
    : 'account',
);
const selectedProject = ref(String(route.query.project ?? ''));
const users = ref<AdminUser[]>([]),
  members = ref<ProjectMember[]>([]),
  search = ref(''),
  stateFilter = ref('all'),
  page = ref(1),
  membersLoading = ref(false),
  busy = ref(false),
  actionError = ref(''),
  notice = ref(''),
  adding = ref(false);
const editor = ref<{ mode: 'create' | 'account' | 'member'; user?: AdminUser } | null>(null);
const confirmation = ref<{ kind: 'reset' | 'remove'; user: AdminUser | ProjectMember } | null>(
  null,
);
const credentials = ref<{ login: string; password: string } | null>(null);
const project = computed(() => projects.value.find((p) => p.id === selectedProject.value));
const customerName = computed(
  () => customers.value.find((c) => c.id === project.value?.customerId)?.name ?? '',
);
const filteredUsers = computed(() =>
  users.value.filter(
    (u) =>
      (u.displayName + u.loginName + (u.email ?? ''))
        .toLowerCase()
        .includes(search.value.toLowerCase()) &&
      (stateFilter.value === 'all' ||
        (tab.value === 'account' ? u.status : u.memberStatus) === stateFilter.value),
  ),
);
const shownUsers = computed(() =>
  filteredUsers.value.slice((page.value - 1) * 10, page.value * 10),
);
watch([search, stateFilter, tab], () => (page.value = 1));
async function handleError(e: unknown) {
  error.value = (e as Error).message;
  if (e instanceof ApiError && e.status === 401) await router.replace('/login');
}
async function reload() {
  await load();
  if (error.value) return;
  try {
    users.value = await adminApi.users();
    if (!selectedProject.value && projects.value.length)
      selectedProject.value = projects.value[0]!.id;
    await loadMembers();
  } catch (e) {
    await handleError(e);
  }
}
let memberLoad = 0;
async function loadMembers() {
  const sequence = ++memberLoad;
  members.value = [];
  if (!project.value) {
    membersLoading.value = false;
    return;
  }
  membersLoading.value = true;
  try {
    const result = await adminApi.projectMembers(project.value.id);
    if (sequence === memberLoad) members.value = result;
  } catch (e) {
    if (sequence === memberLoad) await handleError(e);
  } finally {
    if (sequence === memberLoad) membersLoading.value = false;
  }
}
watch(selectedProject, () => {
  adding.value = false;
  actionError.value = '';
  void loadMembers();
});
function chooseProject(id: string) {
  selectedProject.value = id;
}
function chooseCustomer(id: string) {
  selectedProject.value = projects.value.find((p) => p.customerId === id)?.id ?? '';
}
function openEditor(mode: 'create' | 'account' | 'member', user?: AdminUser) {
  actionError.value = '';
  editor.value = { mode, user };
}
async function save(body: Record<string, unknown>) {
  if (!editor.value) return;
  busy.value = true;
  actionError.value = '';
  try {
    const e = editor.value;
    if (e.mode === 'create') {
      const result = await adminApi.createUser(body);
      credentials.value = { login: result.user.loginName, password: result.temporaryPassword };
    } else if (e.mode === 'account') await adminApi.saveUser(e.user!.id, body);
    else await adminApi.saveMember(e.user!.id, body);
    editor.value = null;
    notice.value = '用户与成员信息已更新。';
    await reload();
  } catch (e) {
    actionError.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
async function add(id: string) {
  busy.value = true;
  actionError.value = '';
  try {
    await adminApi.addMember(selectedProject.value, id);
    adding.value = false;
    notice.value = '已添加项目成员。';
    await reload();
  } catch (e) {
    actionError.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
function ask(kind: 'reset' | 'remove', user: AdminUser | ProjectMember) {
  actionError.value = '';
  confirmation.value = { kind, user };
}
async function confirm() {
  if (!confirmation.value) return;
  busy.value = true;
  actionError.value = '';
  try {
    const c = confirmation.value;
    if (c.kind === 'reset') {
      const result = await adminApi.resetPassword(c.user.id, c.user.rowVersion);
      credentials.value = { login: c.user.loginName, password: result.temporaryPassword };
    } else {
      await adminApi.removeMember(selectedProject.value, c.user.id, c.user.rowVersion);
      notice.value = '已移出项目；账号与企业成员身份保留。';
    }
    confirmation.value = null;
    await reload();
  } catch (e) {
    actionError.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
onMounted(reload);
</script>
<template>
  <div class="admin-page">
    <div class="page-heading">
      <div>
        <p class="eyebrow">USERS & MEMBERSHIPS</p>
        <h1>用户与成员</h1>
        <p class="muted">管理用户账号，在企业与项目中分配成员，明确每一次访问的范围。</p>
      </div>
      <div class="toolbar-actions">
        <button class="secondary-button" :disabled="loading" @click="reload">
          <AppIcon name="refresh" :size="16" />刷新</button
        ><button
          v-if="identity?.canManageOrganization"
          class="primary-button"
          @click="openEditor('create')"
        >
          <AppIcon name="plus" :size="16" />新建用户
        </button>
      </div>
    </div>
    <p v-if="notice" class="success-note" role="status">{{ notice }}</p>
    <p v-if="error" class="error-note" role="alert">{{ error }}</p>
    <p v-if="loading && !organization" class="loading-state">正在加载管理数据…</p>
    <template v-if="organization && identity?.canManageOrganization"
      ><nav class="admin-tabs" aria-label="成员管理范围">
        <button
          v-for="entry in [
            { id: 'account', label: '用户账号' },
            { id: 'member', label: '企业成员' },
            { id: 'project', label: '项目成员' },
          ]"
          :key="entry.id"
          :aria-current="tab === entry.id ? 'page' : undefined"
          :class="{ active: tab === entry.id }"
          @click="
            tab = entry.id;
            search = '';
            stateFilter = 'all';
          "
        >
          {{ entry.label }}
        </button>
      </nav>
      <template v-if="tab !== 'project'"
        ><section class="surface user-table-surface">
          <div class="admin-toolbar">
            <h2>
              {{ tab === 'account' ? '用户账号' : '企业成员' }}
              <span class="count-badge">{{ filteredUsers.length }}</span>
            </h2>
            <div class="toolbar-actions">
              <div class="filter-input">
                <AppIcon name="search" :size="16" /><input
                  v-model="search"
                  aria-label="搜索用户"
                  placeholder="搜索姓名、账号或邮箱…"
                />
              </div>
              <select v-model="stateFilter" class="admin-filter-select" aria-label="筛选成员状态">
                <option value="all">全部状态</option>
                <option value="active">正常</option>
                <option value="disabled">已停用</option>
              </select>
            </div>
          </div>
          <p class="table-intro">
            {{
              tab === 'account'
                ? '账号决定能否登录；停用不删除历史交付记录。'
                : '企业成员决定组织空间访问；项目范围需要单独分配。'
            }}
          </p>
          <div class="admin-table-wrap">
            <table class="admin-table">
              <thead>
                <tr>
                  <th>用户</th>
                  <th>{{ tab === 'account' ? '邮箱' : '管理身份' }}</th>
                  <th>{{ tab === 'account' ? '账号状态' : '成员状态' }}</th>
                  <th>{{ tab === 'account' ? '最近登录' : '参与项目' }}</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="u in shownUsers" :key="u.id">
                  <td>
                    <div class="member-identity">
                      <span class="avatar">{{ u.displayName.slice(0, 1) }}</span>
                      <div>
                        <strong
                          >{{ u.displayName }}
                          <small v-if="u.id === identity?.user.id" class="self-label"
                            >我</small
                          ></strong
                        >
                        <p>{{ u.loginName }}</p>
                      </div>
                    </div>
                  </td>
                  <td>
                    {{
                      tab === 'account'
                        ? u.email || '—'
                        : u.accessLevel === 'admin'
                          ? '企业管理员'
                          : '普通成员'
                    }}
                  </td>
                  <td>
                    <span
                      class="admin-badge"
                      :class="{
                        muted: (tab === 'account' ? u.status : u.memberStatus) !== 'active',
                      }"
                      >{{
                        (tab === 'account' ? u.status : u.memberStatus) === 'active'
                          ? '正常'
                          : '已停用'
                      }}</span
                    >
                  </td>
                  <td>
                    {{
                      tab === 'account' ? displayDate(u.lastLoginAt) : u.projectCount + ' 个项目'
                    }}
                  </td>
                  <td>
                    <div class="row-actions">
                      <button
                        class="text-button"
                        @click="openEditor(tab === 'account' ? 'account' : 'member', u)"
                      >
                        {{ tab === 'account' ? '编辑' : '管理成员' }}</button
                      ><button
                        v-if="tab === 'account' && u.id !== identity?.user.id"
                        class="text-button"
                        @click="ask('reset', u)"
                      >
                        重置密码
                      </button>
                    </div>
                  </td>
                </tr>
                <tr v-if="!shownUsers.length">
                  <td colspan="5" class="table-empty">未找到匹配用户，请调整筛选条件。</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="admin-pagination">
            <span>共 {{ filteredUsers.length }} 位用户</span
            ><button :disabled="page === 1" @click="page--">上一页</button
            ><span>{{ page }} / {{ Math.max(1, Math.ceil(filteredUsers.length / 10)) }}</span
            ><button :disabled="page * 10 >= filteredUsers.length" @click="page++">下一页</button>
          </div>
        </section>
        <p class="admin-footnote">
          <AppIcon
            name="shield"
            :size="15"
          />企业管理员可以维护本企业资料和成员；更多角色权限将在后续独立配置。
        </p></template
      >
      <div v-else class="admin-workspace members-workspace">
        <RelationTree
          :organization-name="organization.name"
          :customers="customers"
          :projects="projects"
          :selected-project="selectedProject"
          mode="project"
          @project="chooseProject"
          @customer="chooseCustomer"
        />
        <section class="surface project-members-surface">
          <div class="section-heading">
            <div>
              <h2>{{ project?.name || '选择一个项目' }}</h2>
              <p class="table-intro">
                {{ project ? customerName + ' · 项目成员' : '从左侧项目关系中选择要管理的范围。' }}
              </p>
            </div>
            <button
              v-if="project"
              class="primary-button"
              :disabled="project.status === 'archived' || membersLoading"
              @click="
                adding = true;
                actionError = '';
              "
            >
              <AppIcon name="plus" :size="15" />添加成员
            </button>
          </div>
          <p v-if="project?.status === 'archived'" class="help-note">
            此项目已归档，成员关系只读。
          </p>
          <p v-if="membersLoading" class="loading-state">正在加载成员…</p>
          <div v-else-if="!project" class="admin-empty">
            <AppIcon name="folder" :size="32" />
            <h3>先建立项目，再组织协作</h3>
            <p>在客户与项目中创建项目后，即可分配成员。</p>
            <RouterLink to="/workspace/organization" class="secondary-button"
              >前往客户与项目<AppIcon name="arrow" :size="15"
            /></RouterLink>
          </div>
          <div v-else class="admin-table-wrap">
            <table class="admin-table">
              <thead>
                <tr>
                  <th>成员</th>
                  <th>状态</th>
                  <th>加入日期</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="u in members" :key="u.id">
                  <td>
                    <div class="member-identity">
                      <span class="avatar">{{ u.displayName.slice(0, 1) }}</span>
                      <div>
                        <strong>{{ u.displayName }}</strong>
                        <p>{{ u.loginName }}</p>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span class="admin-badge">{{
                      u.accountStatus !== 'active'
                        ? '账号已停用'
                        : u.organizationStatus !== 'active'
                          ? '企业成员停用'
                          : '正常'
                    }}</span>
                  </td>
                  <td>{{ displayDate(u.joinedAt) }}</td>
                  <td>
                    <button
                      class="text-button"
                      :disabled="project.status === 'archived'"
                      @click="ask('remove', u)"
                    >
                      移出
                    </button>
                  </td>
                </tr>
                <tr v-if="!members.length">
                  <td colspan="4" class="table-empty">
                    此项目尚无成员。添加后，成员即可在“我的项目”中访问。
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-if="project" class="admin-footnote">
            <AppIcon name="shield" :size="14" />移出项目仅收回该项目访问权，不停用账号。
          </p>
        </section>
        <MemberAssignment
          v-if="adding && project"
          :users="users"
          :members="members"
          :busy="busy"
          :error="actionError"
          @close="adding = false"
          @add="add"
        /></div></template
    ><UserEditor
      v-if="editor"
      :mode="editor.mode"
      :user="editor.user"
      :self="editor.user?.id === identity?.user.id"
      :busy="busy"
      :error="actionError"
      @close="editor = null"
      @save="save"
    /><AdminDialog
      v-if="confirmation"
      :title="confirmation.kind === 'reset' ? '重置临时密码' : '移出项目成员'"
      :busy="busy"
      :error="actionError"
      submit-label="确认操作"
      @close="confirmation = null"
      @submit="confirm"
      ><p>
        即将{{ confirmation.kind === 'reset' ? '重置' : '移出' }}
        <strong>{{ confirmation.user.displayName }}</strong
        >。
      </p>
      <p class="help-note">
        {{
          confirmation.kind === 'reset'
            ? '旧密码和所有登录会话会失效。新临时密码仅显示一次，下次登录须修改。'
            : '该用户将立即失去此项目的访问权。账号、企业成员资格和历史记录均保留。'
        }}
      </p></AdminDialog
    ><AdminDialog
      v-if="credentials"
      title="请安全交接临时密码"
      submit-label="我已保存，关闭"
      hide-cancel
      @close="credentials = null"
      @submit="credentials = null"
      ><p class="dialog-description">
        此密码仅在本次弹窗显示，关闭后无法再次查看。请通过可信渠道交给账号本人。
      </p>
      <label>登录账号</label>
      <div class="credential-value">{{ credentials.login }}</div>
      <label>临时密码</label>
      <div class="credential-value" role="status">{{ credentials.password }}</div>
      <p class="help-note">
        首次登录必须修改密码；请勿将临时密码写入项目文档或公开消息。
      </p></AdminDialog
    >
  </div>
</template>
