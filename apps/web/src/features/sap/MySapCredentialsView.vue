<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import BaseButton from '../../components/base/BaseButton.vue';
import BaseSkeleton from '../../components/base/BaseSkeleton.vue';
import BaseTag from '../../components/base/BaseTag.vue';
import { toast } from '../../components/base/toast';
import SettingsPage from '../settings/SettingsPage.vue';
import SettingsCard from '../settings/SettingsCard.vue';
import { useLoad, useSave } from '../settings/useLoad';
import SapLoginDialog from './SapLoginDialog.vue';
import { credentialLabel, purposeLabel, sapApi, type SapSystem } from './api';
import '../settings/settings.css';

// 个人 → 我的 SAP 凭据 (docs/specs/project-access-admin.md 3.3–3.4): every project system the
// user may read, with their own login state; logging in and out from one place.
const { data, loading, error, reload } = useLoad(sapApi.mine);
onMounted(reload);
const groups = computed(() => {
  const map = new Map<
    string,
    {
      projectId: string;
      projectName: string;
      projectCode: string;
      items: NonNullable<typeof data.value>['items'];
    }
  >();
  for (const item of data.value?.items ?? []) {
    if (!map.has(item.projectId))
      map.set(item.projectId, {
        projectId: item.projectId,
        projectName: item.projectName,
        projectCode: item.projectCode,
        items: [],
      });
    map.get(item.projectId)!.items.push(item);
  }
  return [...map.values()];
});
const saved = computed(
  () => (data.value?.items ?? []).filter((i) => i.credential.state === 'saved').length,
);
const loginOpen = ref(false);
const target = ref<{ projectId: string; system: SapSystem } | null>(null);
function login(projectId: string, system: SapSystem, username: string) {
  target.value = { projectId, system: { ...system, credential: { state: 'none', username } } };
  loginOpen.value = true;
}
const action = useSave();
async function logout(projectId: string, system: SapSystem) {
  if (await action.run(() => sapApi.logout(projectId, system.id))) {
    toast('已退出 ' + system.name, 'green');
    await reload();
  }
}
const fmt = (v?: string | null) => (v ? v.slice(0, 10) : '');
</script>
<template>
  <SettingsPage
    title="我的 SAP 凭据"
    description="你在各项目 SAP 系统中使用的本人账号。凭据只用于你本人发起的请求，管理员也不能代用。"
  >
    <p v-if="error || action.error.value" class="s-error" role="alert">
      {{ error || action.error.value }}
    </p>
    <BaseSkeleton v-if="loading && !data" height="200px" />
    <template v-if="data">
      <p class="s-note">
        已加密保存 {{ saved }} 个。{{
          data.canSave
            ? `保存 ${data.policy.maxDays} 天，${data.policy.idleDays} 天不用自动失效。`
            : '企业安全策略不允许你保存 SAP 密码，只能“本次登录有效”。'
        }}
      </p>
      <SettingsCard
        v-for="g in groups"
        :key="g.projectId"
        :title="g.projectName"
        :description="g.projectCode"
        flush
      >
        <div class="s-list">
          <div v-for="i in g.items" :key="i.system.id" class="s-list-row">
            <span class="sid">{{ i.system.sid }}</span>
            <span class="s-list-main">
              <strong>{{ i.system.name }}</strong>
              <small>{{ purposeLabel(i.system.purpose) }} · client {{ i.system.client }}</small>
            </span>
            <span class="s-list-side">
              <BaseTag :tone="i.credential.state === 'none' ? 'neutral' : 'green'"
                >{{ credentialLabel[i.credential.state]
                }}{{ i.credential.username ? ' · ' + i.credential.username : '' }}</BaseTag
              >
              <span v-if="i.credential.state === 'saved'"
                >到期 {{ fmt(i.credential.expiresAt) }}</span
              >
              <BaseButton
                v-if="i.credential.state === 'saved' || i.credential.state === 'session'"
                size="sm"
                variant="ghost"
                @click="logout(i.projectId, i.system)"
                >{{ i.credential.state === 'saved' ? '删除' : '退出' }}</BaseButton
              >
              <BaseButton
                v-else
                size="sm"
                @click="login(i.projectId, i.system, i.credential.username)"
                >登录</BaseButton
              >
            </span>
          </div>
        </div>
      </SettingsCard>
      <SettingsCard v-if="!groups.length">
        <p class="s-note">你所在的项目还没有登记你能读取的 SAP 系统。</p>
      </SettingsCard>
    </template>
    <SapLoginDialog
      v-if="data && target"
      v-model:open="loginOpen"
      :project-id="target.projectId"
      :system="target.system"
      :can-save="data.canSave"
      :policy="data.policy"
      @saved="reload"
    />
  </SettingsPage>
</template>
<style scoped>
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
</style>
