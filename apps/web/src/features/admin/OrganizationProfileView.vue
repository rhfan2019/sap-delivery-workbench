<script setup lang="ts">
import { onMounted, ref } from 'vue';
import AppIcon from '../../components/AppIcon.vue';
import { identity, restoreSession } from '../../services/session';
import { adminApi } from './api';
import type { Organization } from './types';
import OrganizationEditor from './components/OrganizationEditor.vue';
import './admin.css';
const organization = ref<Organization | null>(null),
  editing = ref(false),
  busy = ref(false),
  error = ref(''),
  saveError = ref(''),
  notice = ref('');
async function load() {
  try {
    organization.value = await adminApi.organization();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function save(body: Record<string, unknown>) {
  busy.value = true;
  saveError.value = '';
  try {
    await adminApi.saveOrganization(body);
    await restoreSession();
    await load();
    editing.value = false;
    notice.value = '企业资料已保存。';
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
  <div class="admin-page">
    <div class="page-heading">
      <div>
        <p class="eyebrow">ORGANIZATION PROFILE</p>
        <h1>企业资料</h1>
        <p class="muted">维护团队所属企业的信息。</p>
      </div>
    </div>
    <p v-if="error" class="error-note" role="alert">{{ error }}</p>
    <p v-if="notice" class="success-note" role="status">{{ notice }}</p>
    <p v-if="!identity?.canManageOrganization">此功能仅限企业管理员使用。</p>
    <section v-else-if="organization" class="organization-summary">
      <span class="organization-emblem"><AppIcon name="building" :size="27" /></span>
      <div>
        <h2>{{ organization.name }} <span class="admin-badge">当前企业</span></h2>
        <p>企业编码 {{ organization.code }} · 企业是团队数据、配置与成员的组织空间</p>
      </div>
      <button
        class="secondary-button"
        @click="
          saveError = '';
          editing = true;
        "
      >
        编辑企业资料
      </button>
    </section>
    <OrganizationEditor
      v-if="editing && organization"
      kind="organization"
      :record="organization"
      :customers="[]"
      customer-id=""
      :busy="busy"
      :error="saveError"
      @close="editing = false"
      @save="save"
    />
  </div>
</template>
