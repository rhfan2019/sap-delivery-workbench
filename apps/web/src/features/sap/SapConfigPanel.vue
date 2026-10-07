<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '../../services/session';
import type { SapRow, SapView, Effective } from './types';
import './sap.css';
const props = defineProps<{ path: string; mode: 'project' | 'personal' | 'temporary' }>();
const data = ref<SapView | null>(null),
  rows = ref<SapRow[]>([]),
  busy = ref(false),
  error = ref(''),
  notice = ref(''),
  baseline = ref('');
const selected = ref('DEV'),
  table = ref('T000'),
  result = ref('');
const dirty = computed(
  () => props.mode !== 'temporary' && JSON.stringify(rows.value) !== baseline.value,
);
function adopt(view: SapView) {
  data.value = view;
  rows.value = view.rows.map((row) =>
    props.mode === 'temporary'
      ? {
          environment: row.environment,
          systemId: null,
          client: null,
          username: null,
          language: null,
          passwordMode: 'inherit',
          hasPassword: false,
          rowVersion: '0',
          passwordAction: 'keep',
          password: '',
        }
      : { ...row, passwordAction: 'keep', password: '' },
  );
  baseline.value = JSON.stringify(rows.value);
}
async function load() {
  busy.value = true;
  error.value = '';
  try {
    adopt(await api<SapView>(props.path));
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
async function save() {
  if (props.mode === 'temporary' || busy.value) return;
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    adopt(await api<SapView>(props.path, { rows: rows.value }));
    notice.value = '三套 SAP 配置已保存。';
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
async function query(preview = false) {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  result.value = '';
  try {
    const value = await api<Effective | unknown>(props.path + (preview ? '/resolve' : '/table'), {
      environment: selected.value,
      temporary: rows.value.find((r) => r.environment === selected.value),
      ...(preview ? {} : { tableName: table.value }),
    });
    result.value = JSON.stringify(value, null, 2);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
function effective(env: string) {
  return data.value?.effective.find((r) => r.environment === env);
}
function source(value?: string) {
  return (
    (
      {
        project: '项目默认',
        personal: '个人参数',
        temporary: '本次修改',
        system: '系统默认',
      } as Record<string, string>
    )[value ?? ''] ?? '未配置'
  );
}
defineExpose({ dirty, busy });
onMounted(load);
</script>
<template>
  <div class="sap-config-panel">
    <p class="sap-hint">
      {{
        mode === 'project'
          ? '为项目配置 DEV、QAS、PRD。Client、用户名和密码可暂不填写。'
          : mode === 'personal'
            ? '空字段继承项目默认值；切换系统后需重新设置登录信息。'
            : '已自动加载项目默认和个人参数。下方修改只用于本次操作，不会保存。'
      }}
    </p>
    <p v-if="error" class="error-note" role="alert">{{ error }}</p>
    <p v-if="notice" role="status">{{ notice }}</p>
    <p v-if="!data && busy">正在加载 SAP 参数…</p>
    <template v-if="data">
      <p v-if="data.readOnly" class="sap-hint">项目已归档：仅可查看。</p>
      <form @submit.prevent="save">
        <fieldset :disabled="busy || data.readOnly" class="sap-fieldset">
          <div class="sap-environments">
            <section v-for="row in rows" :key="row.environment" class="sap-environment">
              <header>
                <h3>{{ row.environment }}</h3>
                <span :class="{ 'sap-incomplete': !effective(row.environment)?.credentialReady }">{{
                  effective(row.environment)?.credentialReady
                    ? '连接参数已齐备'
                    : '已保存配置待补充'
                }}</span>
              </header>
              <p class="sap-effective">
                已保存有效值：{{ effective(row.environment)?.systemName || '未配置/不可用' }} ·
                Client {{ effective(row.environment)?.client || '系统默认' }} ·
                {{ effective(row.environment)?.username || '无用户' }} ·
                {{ effective(row.environment)?.language }}<br />来源：系统
                {{ source(effective(row.environment)?.sources.systemId) }}；用户
                {{ source(effective(row.environment)?.sources.username) }}；密码
                {{ source(effective(row.environment)?.sources.password) }}；语言
                {{ source(effective(row.environment)?.sources.language) }}
              </p>
              <label :for="'sap-system-' + row.environment">SAP 系统</label>
              <select :id="'sap-system-' + row.environment" v-model="row.systemId">
                <option :value="null">
                  {{ mode === 'project' ? '暂不配置' : '继承上层配置' }}
                </option>
                <option
                  v-if="row.systemId && !data.systems.some((s) => s.id === row.systemId)"
                  :value="row.systemId"
                  disabled
                >
                  原系统已停用或授权失效
                </option>
                <option v-for="s in data.systems" :key="s.id" :value="s.id">
                  {{ s.name }}（{{ s.code }}）
                </option>
              </select>
              <div class="sap-two-fields">
                <div>
                  <label :for="'sap-client-' + row.environment">Client</label
                  ><input
                    :id="'sap-client-' + row.environment"
                    v-model="row.client"
                    maxlength="3"
                    pattern="[0-9]{3}"
                    :placeholder="mode === 'project' ? '如 000' : '留空继承'"
                    autocomplete="off"
                  />
                </div>
                <div>
                  <label :for="'sap-language-' + row.environment">语言</label
                  ><input
                    :id="'sap-language-' + row.environment"
                    v-model="row.language"
                    maxlength="2"
                    pattern="[A-Za-z]{2}"
                    :placeholder="mode === 'project' ? '系统默认' : '留空继承'"
                    autocomplete="off"
                  />
                </div>
              </div>
              <label :for="'sap-user-' + row.environment">SAP 用户名</label
              ><input
                :id="'sap-user-' + row.environment"
                v-model="row.username"
                maxlength="128"
                :placeholder="mode === 'project' ? '可暂不填写' : '留空继承'"
                autocomplete="off"
              />
              <label :for="'sap-password-mode-' + row.environment">密码</label>
              <select
                :id="'sap-password-mode-' + row.environment"
                v-model="row.passwordAction"
                @change="row.password = ''"
              >
                <option value="keep">
                  {{
                    mode === 'temporary'
                      ? '使用已保存配置'
                      : row.passwordMode === 'inherit'
                        ? '保持继承'
                        : row.hasPassword
                          ? '保留已保存密码'
                          : '保持未设置'
                  }}
                </option>
                <option value="replace">输入新密码</option>
                <option value="clear">不使用密码</option>
                <option v-if="mode === 'personal'" value="inherit">恢复继承项目密码</option>
              </select>
              <input
                v-if="row.passwordAction === 'replace'"
                v-model="row.password"
                :aria-label="row.environment + ' 新密码'"
                type="password"
                required
                maxlength="256"
                autocomplete="new-password"
                placeholder="仅输入新密码，不回显已有密码"
              />
            </section>
          </div>
          <p class="sap-hint">
            修改系统、Client、用户名或系统地址后，旧密码不会自动绑定到新身份。保存的参数是否能登录仍以实际连接验证为准。
          </p>
          <button v-if="mode !== 'temporary'" class="primary-button" :disabled="busy">
            {{ busy ? '保存中…' : '保存三套配置' }}
          </button>
        </fieldset>
      </form>
      <div v-if="mode === 'temporary'" class="sap-query">
        <label for="sap-query-environment">验证环境</label
        ><select id="sap-query-environment" v-model="selected" :disabled="busy">
          <option>DEV</option>
          <option>QAS</option>
          <option>PRD</option>
        </select>
        <label for="sap-query-table">表名</label
        ><input
          id="sap-query-table"
          v-model="table"
          maxlength="30"
          :disabled="busy"
          placeholder="T000"
        />
        <button class="secondary-button" :disabled="busy || data.readOnly" @click="query(true)">
          预览本次参数</button
        ><button
          class="primary-button"
          :disabled="busy || data.readOnly || !table.trim()"
          @click="query()"
        >
          {{ busy ? '读取中…' : '读取表结构' }}
        </button>
        <pre v-if="result" tabindex="0" aria-label="SAP 查询 JSON">{{ result }}</pre>
      </div>
    </template>
    <button v-if="!data && !busy" class="secondary-button" @click="load">重新加载</button>
  </div>
</template>
