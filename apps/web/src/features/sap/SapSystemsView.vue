<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, identity } from '../../services/session';
import type { Customer } from '../admin/types';
import type { SapSystem } from './types';
import AdminDialog from '../admin/components/AdminDialog.vue';
import '../admin/admin.css';
import './sap.css';
const systems = ref<SapSystem[]>([]),
  customers = ref<Customer[]>([]),
  error = ref(''),
  saveError = ref(''),
  busy = ref(false);
const draft = ref<Partial<SapSystem> | null>(null),
  grantSystem = ref<SapSystem | null>(null);
const testSystem = ref<SapSystem | null>(null),
  testing = ref(false),
  testError = ref(''),
  testResult = ref('');
const credentials = ref({ client: '', username: '', password: '' });
function openTest(system: SapSystem) {
  testSystem.value = system;
  credentials.value = { client: '', username: '', password: '' };
  testError.value = '';
  testResult.value = '';
}
function closeTest() {
  if (!testing.value) {
    testSystem.value = null;
    credentials.value.password = '';
  }
}
async function runTest() {
  if (!testSystem.value || testing.value) return;
  testing.value = true;
  testError.value = '';
  testResult.value = '';
  try {
    const result = await api<{ status: string; message: string; system: SapSystem }>(
      '/admin/sap-systems/' + testSystem.value.id + '/test',
      { ...credentials.value, rowVersion: testSystem.value.rowVersion },
    );
    systems.value = systems.value.map((s) => (s.id === result.system.id ? result.system : s));
    testSystem.value = result.system;
    if (result.status === 'passed') testResult.value = result.message;
    else testError.value = result.message;
  } catch (e) {
    testError.value = (e as Error).message;
  } finally {
    credentials.value.password = '';
    testing.value = false;
  }
}
interface Grant {
  customerId: string;
  customerName: string;
  expiresAt: string;
  active: boolean;
  rowVersion: string;
}
const grants = ref<Grant[]>([]),
  grantCustomer = ref(''),
  expires = ref('');
async function load() {
  error.value = '';
  try {
    [systems.value, customers.value] = await Promise.all([
      api<SapSystem[]>('/admin/sap-systems'),
      api<Customer[]>('/admin/customers'),
    ]);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
function edit(system?: SapSystem) {
  saveError.value = '';
  draft.value = system
    ? { ...system }
    : { code: '', name: '', sapUrl: '', language: 'EN', ownerCustomerId: null, status: 'active' };
}
async function save() {
  if (!draft.value) return;
  busy.value = true;
  saveError.value = '';
  try {
    await api(
      '/admin/sap-systems' + (draft.value.id ? '/' + draft.value.id : ''),
      draft.value,
      draft.value.id ? 'PATCH' : 'POST',
    );
    draft.value = null;
    await load();
  } catch (e) {
    saveError.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
async function showGrants(system: SapSystem) {
  saveError.value = '';
  grantSystem.value = system;
  grants.value = [];
  grantCustomer.value = '';
  expires.value = '';
  busy.value = true;
  try {
    grants.value = await api<Grant[]>('/admin/sap-systems/' + system.id + '/grants');
  } catch (e) {
    saveError.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
async function saveGrant(existing?: Grant) {
  if (!grantSystem.value) return;
  saveError.value = '';
  busy.value = true;
  try {
    const previous = existing ?? grants.value.find((g) => g.customerId === grantCustomer.value);
    await api('/admin/sap-systems/' + grantSystem.value.id + '/grants', {
      customerId: existing?.customerId ?? grantCustomer.value,
      expiresAt: existing?.expiresAt ?? new Date(expires.value).toISOString(),
      active: !existing,
      rowVersion: previous?.rowVersion ?? '0',
    });
    grants.value = await api<Grant[]>('/admin/sap-systems/' + grantSystem.value.id + '/grants');
    grantCustomer.value = '';
    expires.value = '';
  } catch (e) {
    saveError.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
onMounted(() => {
  if (identity.value?.canManageOrganization) void load();
});
</script>
<template>
  <section class="admin-page">
    <header class="page-heading">
      <div>
        <h1>SAP系统</h1>
        <p>管理后端系统归属与客户使用范围，登录信息在项目及个人参数中维护。</p>
      </div>
      <button v-if="identity?.canManageOrganization" class="primary-button" @click="edit()">
        新增 SAP 系统
      </button>
    </header>
    <p v-if="!identity?.canManageOrganization">此功能仅限企业管理员使用。</p>
    <template v-else
      ><p v-if="error" class="error-note">{{ error }}</p>
      <div class="surface admin-table-wrap sap-system-list">
        <table class="admin-table">
          <thead>
            <tr>
              <th>系统</th>
              <th>归属</th>
              <th>ADT URL</th>
              <th>语言</th>
              <th>后端版本</th>
              <th>最近连接测试</th>
              <th>启用状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in systems" :key="s.id">
              <td>
                <strong>{{ s.name }}</strong
                ><br />{{ s.code }}
              </td>
              <td>{{ s.ownerName || '企业自有' }}</td>
              <td class="sap-system-url">{{ s.sapUrl }}</td>
              <td>{{ s.language }}</td>
              <td>{{ s.backendVersion || '尚未读取' }}</td>
              <td>
                <span
                  class="sap-test-state"
                  :class="
                    testing && testSystem?.id === s.id ? 'running' : s.testStatus || 'untested'
                  "
                  >{{
                    testing && testSystem?.id === s.id
                      ? '测试中…'
                      : s.testStatus === 'passed'
                        ? '正常'
                        : s.testStatus === 'failed'
                          ? '失败'
                          : '未测试'
                  }}</span
                ><small class="sap-test-message">{{ s.testMessage }}</small
                ><small v-if="s.testedAt" class="sap-test-message">{{
                  new Date(s.testedAt).toLocaleString()
                }}</small>
              </td>
              <td>{{ s.status === 'active' ? '启用' : '已停用' }}</td>
              <td>
                <div class="row-actions">
                  <button
                    class="text-button"
                    :disabled="testing || s.status !== 'active'"
                    @click="openTest(s)"
                  >
                    测试</button
                  ><button class="text-button" :disabled="testing" @click="edit(s)">编辑</button
                  ><button v-if="s.ownerCustomerId" class="text-button" @click="showGrants(s)">
                    临时授权
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-if="!systems.length" class="table-empty">
          尚无 SAP 系统。新增后可在项目列表配置 DEV、QAS、PRD。
        </p>
      </div>
      <p class="sap-hint">
        企业自有系统可用于本企业客户项目；客户所属系统仅供归属客户及有效期内被授权客户使用。
      </p></template
    >
    <AdminDialog
      v-if="testSystem"
      :title="testSystem.name + ' · 连接测试'"
      :busy="testing"
      :error="testError"
      submit-label="测试连接"
      @close="closeTest"
      @submit="runTest"
    >
      <p class="help-note">通过 ABAP ADT MCP 读取后端组件版本；密码仅用于本次测试。</p>
      <label for="test-client">Client</label
      ><input
        id="test-client"
        v-model="credentials.client"
        pattern="[0-9]{3}"
        maxlength="3"
        required
        :disabled="testing"
      />
      <label for="test-user">用户</label
      ><input
        id="test-user"
        v-model="credentials.username"
        required
        maxlength="100"
        autocomplete="off"
        :disabled="testing"
      />
      <label for="test-password">密码</label
      ><input
        id="test-password"
        v-model="credentials.password"
        type="password"
        required
        autocomplete="new-password"
        :disabled="testing"
      />
      <p v-if="testing" role="status">正在连接 SAP 并读取版本…</p>
      <p v-if="testResult" class="success-note" role="status">
        {{ testResult }} {{ testSystem.backendVersion }}
      </p>
    </AdminDialog>
    <AdminDialog
      v-if="draft"
      :title="draft.id ? '编辑 SAP 系统' : '新增 SAP 系统'"
      :busy="busy"
      :error="saveError"
      @close="draft = null"
      @submit="save"
    >
      <label for="sap-name">系统名称</label
      ><input id="sap-name" v-model="draft.name" required maxlength="200" /><label for="sap-code"
        >编码</label
      ><input
        id="sap-code"
        v-model="draft.code"
        required
        maxlength="32"
        pattern="[A-Za-z0-9][A-Za-z0-9_-]{0,31}"
      /><label for="sap-owner">归属客户</label
      ><select id="sap-owner" v-model="draft.ownerCustomerId" :disabled="!!draft.id">
        <option :value="null">企业自有</option>
        <option v-for="c in customers" :key="c.id" :value="c.id" :disabled="c.status !== 'active'">
          {{ c.name }}
        </option></select
      ><label for="sap-url">ADT URL</label
      ><input
        id="sap-url"
        v-model="draft.sapUrl"
        type="url"
        required
        maxlength="2048"
        placeholder="https://sap.example.com:44300"
      />
      <p class="help-note">
        填写主机地址和端口，不含 /sap/bc/adt 路径。修改地址后原密码需重新录入。
      </p>
      <div class="field-grid">
        <div>
          <label for="sap-lang">默认语言</label
          ><input
            id="sap-lang"
            v-model="draft.language"
            required
            maxlength="2"
            pattern="[A-Za-z]{2}"
          />
        </div>
        <div>
          <label for="sap-status">状态</label
          ><select id="sap-status" v-model="draft.status">
            <option value="active">启用</option>
            <option value="inactive">停用</option>
          </select>
        </div>
      </div></AdminDialog
    >
    <AdminDialog
      v-if="grantSystem"
      :title="grantSystem.name + ' · 临时客户授权'"
      :busy="busy"
      :error="saveError"
      submit-label="保存授权"
      @close="grantSystem = null"
      @submit="saveGrant()"
      ><p class="help-note">授权到期或撤销后，已保存的项目配置也无法继续连接。</p>
      <ul class="sap-grant-list">
        <li v-for="g in grants" :key="g.customerId">
          <span
            >{{ g.customerName }}<br />{{ new Date(g.expiresAt).toLocaleString() }} ·
            {{
              !g.active ? '已撤销' : new Date(g.expiresAt) <= new Date() ? '已到期' : '有效'
            }}</span
          ><button
            v-if="g.active"
            type="button"
            class="text-button"
            :disabled="busy"
            @click="saveGrant(g)"
          >
            撤销
          </button>
        </li>
      </ul>
      <label for="grant-customer">借用客户</label
      ><select id="grant-customer" v-model="grantCustomer" required>
        <option disabled value="">请选择</option>
        <option
          v-for="c in customers.filter(
            (c) => c.id !== grantSystem?.ownerCustomerId && c.status === 'active',
          )"
          :key="c.id"
          :value="c.id"
        >
          {{ c.name }}
        </option></select
      ><label for="grant-expiry">截至时间（本地时间）</label
      ><input id="grant-expiry" v-model="expires" type="datetime-local" required
    /></AdminDialog>
  </section>
</template>
