<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { Search } from '@lucide/vue';
import BaseSkeleton from '../../components/base/BaseSkeleton.vue';
import BaseTable from '../../components/base/BaseTable.vue';
import BaseTag from '../../components/base/BaseTag.vue';
import SettingsPage from '../settings/SettingsPage.vue';
import { useLoad } from '../settings/useLoad';
import { purposeLabel, sapApi } from './api';
import '../settings/settings.css';

// 审计与运维 → SAP 系统一览 (docs/specs/project-access-admin.md 3.2): every system registered in
// any project, read-only, for Basis to see the landscape. Systems are maintained per project.
const { data, loading, error, reload } = useLoad(sapApi.directory);
onMounted(reload);
const query = ref('');
const rows = computed(() =>
  (data.value ?? []).filter((s) =>
    (s.sid + s.name + s.client + s.sapUrl + s.projectName + s.customerName)
      .toLowerCase()
      .includes(query.value.trim().toLowerCase()),
  ),
);
</script>
<template>
  <SettingsPage
    title="SAP 系统一览"
    description="全企业各项目登记的 SAP 系统（只读）。系统在各项目的“SAP 系统”中维护。"
    wide
  >
    <p v-if="error" class="s-error" role="alert">{{ error }}</p>
    <label class="s-search"
      ><Search :size="14" /><input
        v-model="query"
        placeholder="搜索 SID、Client、地址或项目"
        aria-label="搜索 SAP 系统"
    /></label>
    <BaseSkeleton v-if="loading && !data" height="240px" />
    <div v-if="data" class="table-card">
      <BaseTable>
        <table>
          <thead>
            <tr>
              <th>SID</th>
              <th>Client</th>
              <th>名称</th>
              <th>用途</th>
              <th>ADT 地址</th>
              <th>项目</th>
              <th>客户</th>
              <th>最近连接</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in rows" :key="s.id">
              <td class="primary-cell s-mono">{{ s.sid }}</td>
              <td class="s-mono">{{ s.client }}</td>
              <td>
                {{ s.name }} <BaseTag v-if="s.isDefault" tone="blue">默认</BaseTag
                ><BaseTag v-if="s.status === 'inactive'" strike>停用</BaseTag>
              </td>
              <td class="muted-cell">{{ purposeLabel(s.purpose) }}</td>
              <td class="muted-cell s-mono">{{ s.sapUrl }}</td>
              <td>
                {{ s.projectName }}<BaseTag v-if="s.projectStatus === 'archived'">已归档</BaseTag>
              </td>
              <td class="muted-cell">{{ s.customerName }}</td>
              <td>
                <BaseTag v-if="s.testStatus" :tone="s.testStatus === 'passed' ? 'green' : 'red'">{{
                  s.testStatus === 'passed' ? '正常' : '失败'
                }}</BaseTag>
                <span v-else class="muted-cell">—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </BaseTable>
      <p v-if="!rows.length" class="empty-note">
        {{ query ? '没有匹配的系统。' : '还没有项目登记 SAP 系统。' }}
      </p>
    </div>
  </SettingsPage>
</template>
<style scoped>
.table-card {
  border: 1px solid var(--border);
  border-radius: var(--radius-12);
  background: var(--panel);
  box-shadow: var(--shadow-card);
  overflow: hidden;
}
.empty-note {
  margin: 0;
  padding: var(--space-4);
  color: var(--text-muted);
}
</style>
