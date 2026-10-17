<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import AppIcon from '../../components/AppIcon.vue';
import { identity, restoreSession } from '../../services/session';
import { useAdminData } from './useAdminData';
import { adminApi } from './api';
import { projectStatus, type Customer, type AdminProject, type Organization } from './types';
import RelationTree from './components/RelationTree.vue';
import OrganizationEditor from './components/OrganizationEditor.vue';
import ProjectSapDialog from '../sap/ProjectSapDialog.vue';
const activeTab = ref<'customer' | 'project'>('customer');
const sapProject = ref<AdminProject | null>(null);
const { organization, customers, projects, loading, error, load } = useAdminData();
const search = ref(''),
  customerId = ref(''),
  projectId = ref(''),
  notice = ref(''),
  busy = ref(false),
  saveError = ref(''),
  page = ref(1);
const editor = ref<{
  kind: 'organization' | 'customer' | 'project';
  record?: Customer | AdminProject | Organization;
} | null>(null);
const customer = computed(() => customers.value.find((c) => c.id === customerId.value));
const filtered = computed(() =>
  customers.value.filter((c) =>
    (c.name + c.code).toLowerCase().includes(search.value.toLowerCase()),
  ),
);
const visible = computed(() => filtered.value.slice((page.value - 1) * 6, page.value * 6));
const related = computed(() =>
  projects.value.filter(
    (p) =>
      (!customerId.value || p.customerId === customerId.value) &&
      (!projectId.value || p.id === projectId.value),
  ),
);
watch([search, customerId], () => (page.value = 1));
function chooseCustomer(id: string) {
  customerId.value = id;
  projectId.value = '';
  search.value = '';
}
function chooseProject(id: string) {
  projectId.value = id;
  customerId.value = projects.value.find((p) => p.id === id)?.customerId ?? '';
  search.value = '';
}
function edit(
  kind: 'organization' | 'customer' | 'project',
  record?: Customer | AdminProject | Organization,
) {
  saveError.value = '';
  editor.value = { kind, record };
}
async function save(body: Record<string, unknown>) {
  if (!editor.value) return;
  busy.value = true;
  saveError.value = '';
  try {
    const e = editor.value;
    if (e.kind === 'organization') {
      await adminApi.saveOrganization(body);
      await restoreSession();
    } else if (e.kind === 'customer') {
      const c = await adminApi.saveCustomer(body, e.record?.id);
      chooseCustomer(c.id);
    } else {
      const p = await adminApi.saveProject(body, e.record?.id);
      projectId.value = p.id;
      customerId.value = p.customerId;
    }
    editor.value = null;
    notice.value = '已保存，最新数据已同步。';
    await load();
  } catch (e) {
    saveError.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
onMounted(load);
</script>
<template>
  <div class="admin-page">
    <div class="page-heading">
      <div>
        <h1>客户与项目</h1>
        <p class="muted">管理客户档案及关联项目，在清晰的业务关系中开展交付。</p>
      </div>
      <button class="secondary-button" :disabled="loading" @click="load">
        <AppIcon name="refresh" :size="16" />刷新
      </button>
    </div>
    <p v-if="notice" class="success-note" role="status">{{ notice }}</p>
    <p v-if="error" class="error-note" role="alert">{{ error }}</p>
    <p v-if="loading && !organization" class="loading-state">正在加载企业资料…</p>
    <template v-if="organization && identity?.canManageOrganization"
      ><nav class="tabs admin-tabs" aria-label="客户与项目范围">
        <button
          :class="{ active: activeTab === 'customer' }"
          :aria-current="activeTab === 'customer' ? 'page' : undefined"
          @click="activeTab = 'customer'"
        >
          客户
        </button>
        <button
          :class="{ active: activeTab === 'project' }"
          :aria-current="activeTab === 'project' ? 'page' : undefined"
          @click="activeTab = 'project'"
        >
          项目
        </button>
      </nav>
      <div :class="activeTab === 'project' ? 'admin-workspace' : 'customer-workspace'">
        <RelationTree
          v-if="activeTab === 'project'"
          :organization-name="organization.name"
          :customers="customers"
          :projects="projects"
          :selected-customer="customerId"
          :selected-project="projectId"
          @customer="chooseCustomer"
          @project="chooseProject"
        />
        <div class="admin-content">
          <template v-if="activeTab === 'customer'">
            <div class="admin-toolbar">
              <div>
                <h2>
                  全部客户
                  <span class="count-badge">{{ filtered.length }}</span>
                </h2>
              </div>
              <div class="toolbar-actions">
                <div class="filter-input">
                  <AppIcon name="search" :size="16" /><input
                    v-model="search"
                    aria-label="搜索客户"
                    placeholder="搜索客户名称、编码…"
                  />
                </div>
                <button class="primary-button" @click="edit('customer')">
                  <AppIcon name="plus" :size="16" />新建客户
                </button>
              </div>
            </div>
            <div v-if="!filtered.length" class="admin-empty surface">
              <AppIcon name="building" :size="35" />
              <h3>{{ customers.length ? '未找到匹配客户' : '建立你的第一份客户档案' }}</h3>
              <p>
                {{
                  customers.length
                    ? '请更换关键词或查看全部客户。'
                    : '客户是项目服务的甲方。创建档案后，即可建立项目并分配成员。'
                }}
              </p>
              <button v-if="!customers.length" class="primary-button" @click="edit('customer')">
                新建客户
              </button>
            </div>
            <div v-else class="customer-grid">
              <article
                v-for="c in visible"
                :key="c.id"
                class="customer-card"
                :class="{ selected: c.id === customerId }"
              >
                <div class="customer-card-top">
                  <span class="icon-tile"><AppIcon name="building" :size="23" /></span
                  ><span class="admin-badge" :class="{ muted: c.status !== 'active' }">{{
                    c.status === 'active' ? '正常' : '已停用'
                  }}</span>
                </div>
                <h3>{{ c.name }}</h3>
                <p class="customer-code">
                  {{ c.code }} · {{ c.customerKind === 'self' ? '企业自身' : '外部客户' }}
                </p>
                <p class="customer-description">{{ c.description || '尚未填写客户说明' }}</p>
                <div class="customer-project-count">
                  <AppIcon name="folder" :size="16" />关联项目
                  <strong>{{ projects.filter((p) => p.customerId === c.id).length }} 个</strong>
                </div>
                <footer>
                  <button
                    class="text-link"
                    @click="
                      chooseCustomer(c.id);
                      activeTab = 'project';
                    "
                  >
                    查看关联项目<AppIcon name="arrow" :size="15" /></button
                  ><button
                    class="text-button"
                    :aria-label="'编辑客户 ' + c.name"
                    @click="edit('customer', c)"
                  >
                    编辑
                  </button>
                </footer>
              </article>
            </div>
            <div v-if="filtered.length > 6" class="admin-pagination">
              <span>共 {{ filtered.length }} 个客户</span
              ><button :disabled="page === 1" @click="page--">上一页</button
              ><span>{{ page }} / {{ Math.ceil(filtered.length / 6) }}</span
              ><button :disabled="page * 6 >= filtered.length" @click="page++">下一页</button>
            </div>
          </template>
          <section v-else class="surface related-projects">
            <div class="section-heading">
              <h2>
                {{ customer ? customer.name + ' · 关联项目' : '关联项目' }}
                <span class="count-badge">{{ related.length }}</span>
              </h2>
              <button
                class="primary-button"
                :disabled="!customers.some((c) => c.status === 'active')"
                @click="edit('project')"
              >
                <AppIcon name="plus" :size="15" />新建项目
              </button>
            </div>
            <div v-if="!related.length" class="table-empty">
              {{
                customer
                  ? '此客户尚无项目，创建项目后可继续分配成员。'
                  : '选择客户或创建项目，开始组织交付工作。'
              }}
            </div>
            <div v-else class="admin-table-wrap">
              <table class="admin-table">
                <thead>
                  <tr>
                    <th>项目名称</th>
                    <th>项目编码</th>
                    <th>状态</th>
                    <th>计划日期</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="p in related" :key="p.id">
                    <td>
                      <strong>{{ p.name }}</strong>
                    </td>
                    <td>{{ p.code }}</td>
                    <td>
                      <span class="admin-badge">{{ projectStatus(p.status) }}</span>
                    </td>
                    <td class="date-cell">
                      {{ p.plannedStartDate || '未设置' }}<br />{{ p.plannedEndDate || '未设置' }}
                    </td>
                    <td>
                      <div class="row-actions">
                        <button class="text-button" @click="sapProject = p">SAP 系统</button>
                        <button
                          class="text-button"
                          :disabled="p.status === 'archived'"
                          @click="edit('project', p)"
                        >
                          编辑</button
                        ><RouterLink
                          :to="{
                            path: '/workspace/members',
                            query: { tab: 'project', project: p.id },
                          }"
                          class="text-link"
                          >成员</RouterLink
                        >
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
          <p class="admin-footnote">
            <AppIcon name="shield" :size="15" />客户档案不授予访问权限；项目访问由成员关系决定。
          </p>
        </div>
      </div></template
    ><ProjectSapDialog
      v-if="sapProject"
      :project-id="sapProject.id"
      :project-name="sapProject.name"
      @close="sapProject = null"
    /><OrganizationEditor
      v-if="editor"
      :kind="editor.kind"
      :record="editor.record"
      :customers="customers"
      :customer-id="customerId"
      :busy="busy"
      :error="saveError"
      @close="editor = null"
      @save="save"
    />
  </div>
</template>
