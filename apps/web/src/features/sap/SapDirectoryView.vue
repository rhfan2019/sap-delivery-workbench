<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  MinusCircle,
  RefreshCw,
  Search,
  Server,
  XCircle,
} from '@lucide/vue';
import BaseSkeleton from '../../components/base/BaseSkeleton.vue';
import SettingsPage from '../settings/SettingsPage.vue';
import { useLoad } from '../settings/useLoad';
import { purposeLabel, sapApi } from './api';
import '../settings/settings.css';

// 审计与运维 → SAP 系统一览 (docs/specs/project-access-admin.md 3.2): every system registered in
// any project, read-only, for Basis to see the landscape. Systems are maintained per project;
// laid out as a settings list like 大模型 (DESIGN.md 6.2), without a drawer.
const { data, loading, error, reload } = useLoad(sapApi.directory);
onMounted(reload);
type Row = NonNullable<typeof data.value>[number];
const systems = computed(() => data.value ?? []);
const query = ref('');
const purpose = ref('');
const page = ref(1);
const filtered = computed(() =>
  systems.value.filter(
    (s) =>
      (!purpose.value || s.purpose === purpose.value) &&
      (s.sid + s.name + s.client + s.sapUrl + s.projectName + s.customerName)
        .toLowerCase()
        .includes(query.value.trim().toLowerCase()),
  ),
);
const pages = computed(() => Math.max(1, Math.ceil(filtered.value.length / 10)));
const rows = computed(() => filtered.value.slice((page.value - 1) * 10, page.value * 10));
watch([query, purpose], () => (page.value = 1));
watch(pages, (n) => (page.value = Math.min(n, page.value)));
const count = (p: string) => systems.value.filter((s) => s.purpose === p).length;
const inactive = computed(() => systems.value.filter((s) => s.status === 'inactive').length);
const testState = (s: Row) =>
  !s.testStatus ? 'untested' : s.testStatus === 'passed' ? 'passed' : 'failed';
const testIcon = (s: Row) =>
  ({ untested: MinusCircle, passed: CheckCircle2, failed: XCircle })[testState(s)];
</script>
<template>
  <SettingsPage
    title="SAP 系统一览"
    description="全企业各项目登记的 SAP 系统（只读）。系统在各项目的“SAP 系统”中维护。"
    list
  >
    <template #actions>
      <button
        class="icon-button"
        aria-label="刷新 SAP 系统一览"
        :disabled="loading"
        @click="reload"
      >
        <RefreshCw :size="18" />
      </button>
    </template>
    <p v-if="error" class="s-error" role="alert">{{ error }}</p>
    <BaseSkeleton v-if="loading && !data" height="240px" />
    <template v-if="data">
      <p class="s-summary">
        系统：<strong>{{ systems.length }} 个</strong
        ><span
          >· 开发系统 {{ count('development') }} · 测试系统 {{ count('test') }} · 停用
          {{ inactive }}</span
        >
      </p>
      <div class="s-table-toolbar">
        <label class="s-table-search"
          ><Search :size="17" /><input
            v-model="query"
            aria-label="搜索 SAP 系统"
            placeholder="搜索 SID、Client、地址或项目" /></label
        ><select v-model="purpose" aria-label="筛选用途">
          <option value="">全部用途</option>
          <option value="development">开发系统</option>
          <option value="test">测试系统</option>
        </select>
      </div>
      <div class="s-table-surface">
        <div v-if="!rows.length" class="s-table-empty">
          <Server :size="32" />
          <h2>{{ query || purpose ? '没有匹配的系统' : '还没有项目登记 SAP 系统' }}</h2>
          <p>
            {{ query || purpose ? '调整搜索或筛选条件后再试。' : '各项目登记的系统会显示在这里。' }}
          </p>
        </div>
        <table v-else class="s-table">
          <thead>
            <tr>
              <th>系统</th>
              <th>用途</th>
              <th>项目</th>
              <th class="hide-narrow">客户</th>
              <th>最近连接</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in rows" :key="s.id">
              <td>
                <strong class="s-table-main">{{ s.name }}</strong
                ><span v-if="s.isDefault" class="s-badge">默认</span
                ><span v-if="s.status === 'inactive'" class="s-badge muted">停用</span>
                <small class="mono">{{ s.sid }} · client {{ s.client }}</small>
              </td>
              <td>
                <span>{{ purposeLabel(s.purpose) }}</span
                ><small class="mono">{{ s.sapUrl }}</small>
              </td>
              <td>
                <span>{{ s.projectName }}</span
                ><span v-if="s.projectStatus === 'archived'" class="s-badge muted">已归档</span>
                <small class="mono">{{ s.projectCode }}</small>
              </td>
              <td class="hide-narrow">{{ s.customerName }}</td>
              <td>
                <span class="s-state" :class="testState(s)"
                  ><component :is="testIcon(s)" :size="17" />{{
                    testState(s) === 'untested'
                      ? '未测试'
                      : testState(s) === 'passed'
                        ? '正常'
                        : '失败'
                  }}</span
                ><small v-if="s.testedAt" :title="s.testMessage ?? ''">{{
                  s.testedAt.slice(5, 16).replace('T', ' ')
                }}</small>
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
      <p class="s-table-note">这里只读。登记、修改与删除在各项目的“设置 → SAP 系统”中进行。</p>
    </template>
  </SettingsPage>
</template>
