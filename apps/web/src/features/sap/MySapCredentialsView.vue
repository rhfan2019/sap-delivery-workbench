<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { ChevronLeft, ChevronRight, KeyRound, RefreshCw, Search } from '@lucide/vue';
import BaseSkeleton from '../../components/base/BaseSkeleton.vue';
import { toast } from '../../components/base/toast';
import SettingsPage from '../settings/SettingsPage.vue';
import { useLoad, useSave } from '../settings/useLoad';
import SapLoginDialog from './SapLoginDialog.vue';
import { credentialLabel, purposeLabel, sapApi, type SapSystem } from './api';
import '../settings/settings.css';

// 个人 → 我的 SAP 凭据 (docs/specs/project-access-admin.md 3.3–3.4): every project system the
// user may read, with their own login state; logging in and out from one place. A settings list
// like 大模型 (DESIGN.md 6.2): one table for all projects, filtered by project.
const { data, loading, error, reload } = useLoad(sapApi.mine);
onMounted(reload);
const items = computed(() => data.value?.items ?? []);
const projectsOf = computed(() => {
  const map = new Map<string, string>();
  for (const i of items.value) map.set(i.projectId, i.projectName);
  return [...map].map(([id, name]) => ({ id, name }));
});
const saved = computed(() => items.value.filter((i) => i.credential.state === 'saved').length);
const session = computed(() => items.value.filter((i) => i.credential.state === 'session').length);

const query = ref('');
const project = ref('');
const page = ref(1);
const filtered = computed(() =>
  items.value.filter(
    (i) =>
      (!project.value || i.projectId === project.value) &&
      (
        i.system.name +
        i.system.sid +
        i.system.client +
        i.projectName +
        i.projectCode +
        i.credential.username
      )
        .toLowerCase()
        .includes(query.value.trim().toLowerCase()),
  ),
);
const pages = computed(() => Math.max(1, Math.ceil(filtered.value.length / 10)));
const rows = computed(() => filtered.value.slice((page.value - 1) * 10, page.value * 10));
watch([query, project], () => (page.value = 1));
watch(pages, (n) => (page.value = Math.min(n, page.value)));

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
    list
  >
    <template #actions>
      <button
        class="icon-button"
        aria-label="刷新我的 SAP 凭据"
        :disabled="loading"
        @click="reload"
      >
        <RefreshCw :size="18" />
      </button>
    </template>
    <p v-if="error || action.error.value" class="s-error" role="alert">
      {{ error || action.error.value }}
    </p>
    <BaseSkeleton v-if="loading && !data" height="200px" />
    <template v-if="data">
      <p class="s-summary">
        已加密保存：<strong>{{ saved }} 个</strong
        ><span>· 本次登录有效 {{ session }} · 共 {{ items.length }} 个系统</span>
      </p>
      <div class="s-table-toolbar">
        <label class="s-table-search"
          ><Search :size="17" /><input
            v-model="query"
            aria-label="搜索 SAP 系统"
            placeholder="搜索系统、SID、项目或 SAP 用户" /></label
        ><select v-model="project" aria-label="筛选项目">
          <option value="">全部项目</option>
          <option v-for="p in projectsOf" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
      </div>
      <div class="s-table-surface">
        <div v-if="!rows.length" class="s-table-empty">
          <KeyRound :size="32" />
          <h2>{{ query || project ? '没有匹配的系统' : '还没有你能使用的 SAP 系统' }}</h2>
          <p>
            {{
              query || project
                ? '调整搜索或筛选条件后再试。'
                : '你所在的项目还没有登记你能读取的 SAP 系统。'
            }}
          </p>
        </div>
        <table v-else class="s-table">
          <thead>
            <tr>
              <th>系统</th>
              <th>项目</th>
              <th class="hide-narrow">用途</th>
              <th>我的登录</th>
              <th class="actions-col">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="i in rows" :key="i.projectId + i.system.id">
              <td>
                <strong class="s-table-main">{{ i.system.name }}</strong>
                <small class="mono">{{ i.system.sid }} · client {{ i.system.client }}</small>
              </td>
              <td>
                <span>{{ i.projectName }}</span
                ><small class="mono">{{ i.projectCode }}</small>
              </td>
              <td class="hide-narrow">{{ purposeLabel(i.system.purpose) }}</td>
              <td>
                <span class="s-state" :class="i.credential.state === 'none' ? 'untested' : 'passed'"
                  ><KeyRound :size="17" />{{ credentialLabel[i.credential.state]
                  }}{{ i.credential.username ? ' · ' + i.credential.username : '' }}</span
                ><small v-if="i.credential.state === 'saved'"
                  >到期 {{ fmt(i.credential.expiresAt) }}</small
                >
              </td>
              <td>
                <div class="s-row-actions">
                  <button
                    v-if="i.credential.state === 'saved' || i.credential.state === 'session'"
                    class="text-button"
                    :disabled="action.busy.value"
                    @click="logout(i.projectId, i.system)"
                  >
                    {{ i.credential.state === 'saved' ? '删除' : '退出' }}
                  </button>
                  <button
                    v-else
                    class="text-button"
                    @click="login(i.projectId, i.system, i.credential.username)"
                  >
                    登录
                  </button>
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
      <p class="s-table-note">
        {{
          data.canSave
            ? `已加密保存的凭据保存 ${data.policy.maxDays} 天，${data.policy.idleDays} 天不用自动失效。`
            : '企业安全策略不允许你保存 SAP 密码，只能“本次登录有效”。'
        }}
      </p>
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
