<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import {
  Star,
  Search,
  Plus,
  RefreshCw,
  Trash2,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  XCircle,
  MinusCircle,
} from '@lucide/vue';
import { api, can } from '../../services/session';
import { askConfirmation } from '../../services/confirmation';
import SettingsRowMenu from '../settings/SettingsRowMenu.vue';
import { useDrawerLeave } from '../settings/useDrawerLeave';
import ModelDrawer from './ModelDrawer.vue';
import {
  canDefault,
  protocolNames,
  type ModelRecord,
  type ModelList,
  type ModelConfig,
} from './types';
import '../settings/settings.css';
import './models.css';
const data = ref<ModelList>({ items: [], defaultModel: null, defaultRevision: '0' });
const loading = ref(true),
  busy = ref(false),
  error = ref(''),
  notice = ref(''),
  saveError = ref('');
const search = ref(''),
  status = ref(''),
  page = ref(1),
  open = ref(false),
  selected = ref<ModelRecord | null>(null);
const drawer = ref<InstanceType<typeof ModelDrawer> | null>(null),
  testing = ref('');
const filtered = computed(() =>
  data.value.items.filter(
    (m) =>
      (m.name + ' ' + m.modelId + ' ' + m.provider)
        .toLowerCase()
        .includes(search.value.trim().toLowerCase()) &&
      (!status.value || (status.value === 'untested' ? !m.test : m.test?.status === status.value)),
  ),
);
const pages = computed(() => Math.max(1, Math.ceil(filtered.value.length / 10)));
const rows = computed(() => filtered.value.slice((page.value - 1) * 10, page.value * 10));
watch([search, status], () => (page.value = 1));
watch(pages, (n) => (page.value = Math.min(n, page.value)));
async function load() {
  loading.value = true;
  error.value = '';
  try {
    data.value = await api<ModelList>('/admin/models');
    if (open.value && selected.value)
      selected.value = data.value.items.find((m) => m.id === selected.value?.id) ?? selected.value;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
async function canLeave() {
  if (busy.value) {
    error.value = '操作正在进行，请等待完成。';
    return false;
  }
  return !drawer.value?.dirty || (await askConfirmation('放弃尚未保存的模型配置？'));
}
async function close() {
  if (await canLeave()) {
    open.value = false;
    selected.value = null;
    saveError.value = '';
  }
}
const drawerScroll = ref({ left: 0, top: 0 });
async function edit(m: ModelRecord | null) {
  if (busy.value || (open.value && selected.value?.id === m?.id)) return;
  if (open.value && !(await canLeave())) return;
  drawerScroll.value = { left: window.scrollX, top: window.scrollY };
  selected.value = m;
  saveError.value = '';
  open.value = true;
}
async function save(body: ModelConfig & { apiKey: string; rowVersion?: string }) {
  busy.value = true;
  saveError.value = '';
  try {
    await api(
      '/admin/models' + (selected.value ? '/' + selected.value.id : ''),
      body,
      selected.value ? 'PATCH' : 'POST',
    );
    open.value = false;
    selected.value = null;
    notice.value = '配置已保存。请测试后设置为默认；已有默认版本保持不变。';
    await load();
  } catch (e) {
    saveError.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
async function test(m: ModelRecord, capability: 'text' | 'structured_output' = 'text') {
  if (busy.value) return;
  busy.value = true;
  testing.value = m.id;
  error.value = '';
  saveError.value = '';
  notice.value = '';
  try {
    const result = await api<{ status: string; message: string }>(
      '/admin/models/' + m.id + '/test',
      { rowVersion: m.rowVersion, capability },
    );
    notice.value = result.message;
    if (open.value && result.status !== 'passed') saveError.value = result.message;
    await load();
    return result.status === 'passed';
  } catch (e) {
    error.value = (e as Error).message;
    if (open.value) saveError.value = error.value;
  } finally {
    busy.value = false;
    testing.value = '';
  }
}
async function setDefault(m: ModelRecord) {
  if (busy.value) return;
  if (!canDefault(m)) {
    if (!(await test(m))) return;
    m = data.value.items.find((item) => item.id === m.id) ?? m;
  }
  if (
    !(await askConfirmation(
      `将“${m.name}”的 v${m.versionNo} 设为本组织默认模型？仅影响之后启动的任务。`,
    ))
  )
    return;
  busy.value = true;
  error.value = '';
  try {
    await api('/admin/models/' + m.id + '/default', {
      rowVersion: m.rowVersion,
      defaultRevision: data.value.defaultRevision,
    });
    notice.value = '组织默认模型已更新。';
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
async function remove(m: ModelRecord) {
  if (m.isDefault || busy.value) return;
  if (!(await askConfirmation(`删除“${m.name}”？模型将从配置列表移除，历史版本保留。`))) return;
  busy.value = true;
  error.value = '';
  try {
    await api('/admin/models/' + m.id, { rowVersion: m.rowVersion }, 'DELETE');
    notice.value = '模型已移除，历史版本仍保留。';
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
const label = (m: ModelRecord) =>
  testing.value === m.id
    ? '测试中…'
    : !m.test
      ? '未测试'
      : { passed: '测试通过', failed: '测试失败', timeout: '测试超时', running: '测试中' }[
          m.test.status
        ];
const time = (s: string) =>
  new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(s));
// Bringing another tab forward keeps this page as it is; closing its tab asks (workbench-tabs.md 4, 5).
useDrawerLeave(canLeave, () => !!drawer.value?.dirty || busy.value);
onMounted(load);
const rowMenu = (m: ModelRecord) => [
  {
    label: m.isDefault ? '应用已验证修改' : '设为默认',
    icon: Star,
    disabled: busy.value || (m.isDefault && m.versionId === data.value.defaultModel?.versionId),
    run: () => setDefault(m),
  },
  {
    label: '删除',
    icon: Trash2,
    danger: true,
    disabled: busy.value || m.isDefault,
    title: m.isDefault ? '请先切换默认模型' : '',
    run: () => remove(m),
  },
];
</script>
<template>
  <div class="models-page" :class="{ 'drawer-visible': open }">
    <div class="page-heading">
      <div>
        <h1>大模型(LLM)</h1>
        <p class="muted">维护模型接入信息。</p>
      </div>
      <button
        class="icon-button"
        aria-label="刷新模型列表"
        :disabled="loading || busy"
        @click="load"
      >
        <RefreshCw :size="18" />
      </button>
    </div>
    <p v-if="error" class="error-note" role="alert">{{ error }}</p>
    <p v-if="notice" class="success-note" role="status">{{ notice }}</p>
    <template v-if="can('model:view')">
      <p class="s-summary">
        当前默认：<strong>{{ data.defaultModel?.name ?? '尚未设置' }}</strong
        ><span
          >· {{ data.defaultModel ? '对本组织的新任务生效' : '测试通过后，选择一个默认模型' }}</span
        >
      </p>
      <div class="s-table-toolbar">
        <label class="s-table-search"
          ><Search :size="17" /><input
            v-model="search"
            aria-label="搜索模型"
            placeholder="搜索模型名称、标识或提供方" /></label
        ><select v-model="status" aria-label="筛选测试状态">
          <option value="">全部状态</option>
          <option value="passed">测试通过</option>
          <option value="failed">测试失败</option>
          <option value="timeout">测试超时</option>
          <option value="running">测试中</option>
          <option value="untested">未测试</option>
        </select>
        <div class="s-table-actions">
          <button class="primary-button" :disabled="busy" @click="edit(null)">
            <Plus :size="17" />添加模型
          </button>
        </div>
      </div>
      <div class="s-table-surface">
        <p v-if="loading" class="loading-state">正在读取模型…</p>
        <div v-else-if="!rows.length" class="s-table-empty">
          <Star :size="32" />
          <h2>{{ search || status ? '没有匹配的模型' : '添加第一个模型' }}</h2>
          <p>
            {{
              search || status
                ? '调整搜索或筛选条件后再试。'
                : '连接你的模型服务，测试后设置为组织默认。'
            }}
          </p>
          <button v-if="!data.items.length" class="secondary-button" @click="edit(null)">
            添加模型
          </button>
        </div>
        <div v-else>
          <table class="s-table">
            <thead>
              <tr>
                <th class="default-col">默认</th>
                <th>模型名称</th>
                <th class="hide-narrow">提供方</th>
                <th>最近测试</th>
                <th class="actions-col">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="m in rows"
                :key="m.id"
                class="clickable"
                :class="{ selected: selected?.id === m.id }"
                @click="edit(m)"
              >
                <td @click.stop>
                  <button
                    class="s-star"
                    :class="{ active: m.isDefault }"
                    :aria-label="m.isDefault ? '当前默认模型：' + m.name : '设为默认：' + m.name"
                    :aria-pressed="m.isDefault"
                    :disabled="
                      busy || (m.isDefault && m.versionId === data.defaultModel?.versionId)
                    "
                    :title="
                      m.isDefault
                        ? '当前组织默认模型'
                        : canDefault(m)
                          ? '设为默认模型'
                          : '先测试连接，通过后可设为默认'
                    "
                    @click.stop="setDefault(m)"
                  >
                    <Star :size="21" :fill="m.isDefault ? 'currentColor' : 'none'" />
                  </button>
                </td>
                <td>
                  <button class="s-table-name" @click.stop="edit(m)">{{ m.name }}</button
                  ><span v-if="m.isDefault" class="s-badge">默认</span
                  ><small class="mono">{{ m.modelId }}</small
                  ><small
                    v-if="m.isDefault && m.versionId !== data.defaultModel?.versionId"
                    class="model-pending"
                    >有未应用修改 · 当前生效版本保留</small
                  >
                </td>
                <td class="hide-narrow">
                  <span>{{ m.provider }}</span
                  ><small>{{ protocolNames[m.protocol] }}</small>
                </td>
                <td>
                  <span class="s-state" :class="m.test?.status ?? 'untested'"
                    ><component
                      :is="
                        m.test?.status === 'passed'
                          ? CheckCircle2
                          : m.test?.status === 'failed' || m.test?.status === 'timeout'
                            ? XCircle
                            : MinusCircle
                      "
                      :size="17"
                    />{{ label(m) }}</span
                  ><small v-if="m.test" :title="m.test.message"
                    >{{ time(m.test.startedAt)
                    }}<template v-if="m.test.latencyMs != null">
                      · {{ m.test.latencyMs }} ms</template
                    ></small
                  >
                </td>
                <td>
                  <div class="s-row-actions" @click.stop>
                    <button class="text-button" :disabled="busy" @click="edit(m)">编辑</button
                    ><button class="text-button" :disabled="busy" @click="test(m)">
                      {{ testing === m.id ? '测试中' : '测试' }}
                    </button>
                    <SettingsRowMenu :label="m.name + '的更多操作'" :items="rowMenu(m)" />
                  </div>
                  <button
                    v-if="m.isDefault && m.versionId !== data.defaultModel?.versionId"
                    class="text-button model-apply"
                    :disabled="busy"
                    @click.stop="setDefault(m)"
                  >
                    应用已验证修改
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <footer class="s-table-footer">
          <span>共 {{ filtered.length }} 个模型</span>
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
        测试仅验证当前版本的文本生成，结果不代表实时在线状态。默认模型不支持直接删除。
      </p>
    </template>
    <p v-else class="s-table-empty">仅组织管理员可以维护模型配置。</p>
    <ModelDrawer
      v-if="open"
      ref="drawer"
      :key="selected?.id ?? 'new'"
      :record="selected"
      :page-position="drawerScroll"
      :busy="busy"
      :error="saveError"
      @close="close"
      @save="save"
      @test="selected && test(selected)"
    />
  </div>
</template>
