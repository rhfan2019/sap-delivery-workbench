<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import BaseAvatar from '../../components/base/BaseAvatar.vue';
import BaseSkeleton from '../../components/base/BaseSkeleton.vue';
import { toast } from '../../components/base/toast';
import SettingsPage from '../settings/SettingsPage.vue';
import SettingsCard from '../settings/SettingsCard.vue';
import SettingsField from '../settings/SettingsField.vue';
import { useLoad, useSave } from '../settings/useLoad';
import { sapApi, type Policy } from './api';
import '../settings/settings.css';

// 企业 → 安全策略 (docs/specs/project-access-admin.md 3.4): whether and how long people may save
// their SAP passwords, and which saved credentials exist (never their content).
const { data: policy, loading, error, reload } = useLoad(sapApi.policy);
const list = useLoad(sapApi.savedCredentials);
onMounted(() => Promise.all([reload(), list.reload()]));
const draft = ref<Policy | null>(null);
watch(policy, (p) => (draft.value = p ? { ...p } : null));
const dirty = computed(() => JSON.stringify(draft.value) !== JSON.stringify(policy.value));
const save = useSave();
async function submit() {
  const next = await save.run(() => sapApi.savePolicy(draft.value));
  if (next) {
    policy.value = next;
    await list.reload();
    toast('安全策略已保存；已保存的凭据按新策略收紧。', 'green');
  }
}
</script>
<template>
  <SettingsPage
    title="安全策略"
    description="SAP 凭据的保存规则。收紧策略会立即作用于已保存的凭据。"
  >
    <p v-if="error" class="s-error" role="alert">{{ error }}</p>
    <BaseSkeleton v-if="loading && !draft" height="200px" />
    <SettingsCard
      v-if="draft"
      title="SAP 密码保存"
      description="用户可选择“加密保存”（AES-256-GCM，绑定本人、系统、地址、Client 与 SAP 用户）或“本次登录有效”。"
      editable
      :dirty="dirty"
      :saving="save.busy.value"
      :error="save.error.value"
      @save="submit"
    >
      <SettingsField
        label="允许加密保存"
        help="关闭后立即删除所有已保存的 SAP 密码，所有人只能“本次登录有效”。"
      >
        <label class="s-check"><input v-model="draft.allowSave" type="checkbox" />允许</label>
      </SettingsField>
      <SettingsField
        label="最长保存天数"
        for="p-max"
        help="到期后需要重新输入；缩短后已保存的凭据按新天数到期。"
      >
        <input
          id="p-max"
          v-model.number="draft.maxDays"
          class="s-input"
          type="number"
          min="1"
          max="365"
          :disabled="!draft.allowSave"
        />
      </SettingsField>
      <SettingsField label="闲置失效天数" for="p-idle" help="这么多天没有使用即失效。">
        <input
          id="p-idle"
          v-model.number="draft.idleDays"
          class="s-input"
          type="number"
          min="1"
          max="365"
          :disabled="!draft.allowSave"
        />
      </SettingsField>
      <SettingsField label="分包与外部人员" help="不允许时，他们已保存的凭据立即删除。">
        <label class="s-check"
          ><input
            v-model="draft.subcontractorSave"
            type="checkbox"
            :disabled="!draft.allowSave"
          />允许保存</label
        >
      </SettingsField>
    </SettingsCard>
    <SettingsCard
      title="已保存的凭据"
      description="只列出谁在哪个系统保存了凭据，不显示密码。需要强制清除时，打开该用户的详情页。"
      flush
    >
      <div class="s-list">
        <RouterLink
          v-for="c in list.data.value ?? []"
          :key="c.userId + c.sid + c.client + c.projectCode"
          :to="'/settings/users/' + c.userId"
          class="s-list-row"
        >
          <BaseAvatar :name="c.displayName" :size="24" />
          <span class="s-list-main">
            <strong>{{ c.displayName }}</strong>
            <small
              >{{ c.projectName }} · {{ c.systemName }}（{{ c.sid }} client {{ c.client }}）· SAP
              用户 {{ c.sapUsername }}</small
            >
          </span>
          <span class="s-list-side">
            <span>到期 {{ c.expiresAt.slice(0, 10) }}</span>
            <span v-if="c.lastUsedAt">最近使用 {{ c.lastUsedAt.slice(0, 10) }}</span>
          </span>
        </RouterLink>
        <p v-if="!(list.data.value ?? []).length" class="empty-note">目前没有人保存 SAP 密码。</p>
      </div>
    </SettingsCard>
  </SettingsPage>
</template>
<style scoped>
.empty-note {
  margin: 0;
  padding: var(--space-4);
  color: var(--text-muted);
}
</style>
