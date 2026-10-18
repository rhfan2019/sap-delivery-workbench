<script setup lang="ts">
import { ref } from 'vue';
import { can } from '../../services/session';
const table = ref('T000');
const busy = ref(false);
const output = ref('');
const state = ref('等待查询');
async function query() {
  if (busy.value) return;
  busy.value = true;
  output.value = '';
  state.value = '正在读取 SAP 表结构…';
  try {
    const response = await fetch('/api/admin/technical-verification/table', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tableName: table.value }),
    });
    const data = await response.json();
    output.value = JSON.stringify(data, null, 2);
    state.value = response.ok
      ? `查询成功 · ${data.fieldCount} 个字段`
      : (data.message ?? '查询失败');
  } catch {
    state.value = '无法连接服务，请检查网络后重试。';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="admin-page technical-page">
    <header class="page-heading">
      <div>
        <h1>连接诊断</h1>
        <p>用部署配置的 SAP 凭据，经 ABAP ADT MCP 验证表结构读取。</p>
      </div>
    </header>
    <p v-if="!can('ops.diagnostics:run')" role="alert">需要“连接诊断”权限。</p>
    <template v-else>
      <form class="technical-panel" @submit.prevent="query">
        <h2>读取表结构</h2>
        <p>连接服务端已配置的 SAP 系统，读取字段定义并返回 JSON。</p>
        <label for="sap-table-name">数据库表名</label>
        <div class="technical-query">
          <input
            id="sap-table-name"
            v-model="table"
            maxlength="30"
            placeholder="例如 T000、MARA"
            required
            :disabled="busy"
            autocomplete="off"
          />
          <button class="primary-button" type="submit" :disabled="busy || !table.trim()">
            {{ busy ? '查询中…' : '查询表结构' }}
          </button>
        </div>
        <p class="technical-note">
          本页面仅读取表定义，不读取业务数据。当前使用独立验证连接，不受左上角项目切换影响。
        </p>
      </form>
      <section class="technical-panel" :aria-busy="busy">
        <div class="technical-result-heading">
          <h2>JSON 结果</h2>
          <span role="status" aria-live="polite">{{ state }}</span>
        </div>
        <pre v-if="output" tabindex="0" aria-label="表结构 JSON 结果">{{ output }}</pre>
        <div v-else class="technical-empty">
          {{
            busy
              ? '正在连接 MCP 并读取 SAP 数据字典，请稍候。'
              : '输入表名后，查询结果将在这里显示。'
          }}
        </div>
      </section>
    </template>
  </section>
</template>

<style scoped>
.technical-panel {
  border: 1px solid var(--border);
  background: var(--panel);
  border-radius: var(--radius-10);
  padding: var(--space-6);
  margin-bottom: var(--space-5);
}
.technical-panel h2 {
  font-size: var(--font-14);
  margin: 0 0 var(--space-3);
}
.technical-panel p {
  color: var(--text-muted);
  line-height: 1.7;
}
.technical-panel label {
  display: block;
  margin: var(--space-5) 0 var(--space-2);
  font-weight: var(--weight-550);
}
.technical-query {
  display: flex;
  gap: var(--space-3);
  flex-wrap: wrap;
}
.technical-query input {
  width: min(100%, 360px);
  padding: var(--space-2-5) var(--space-3);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-6);
  background: var(--panel);
  color: inherit;
}
.technical-query button {
  padding: var(--space-2-5) var(--space-5);
  border-radius: var(--radius-6);
  border: 0;
  background: var(--link);
  color: var(--on-primary);
  cursor: pointer;
}
.technical-query button:disabled {
  opacity: 0.55;
  cursor: wait;
}
.technical-note {
  font-size: var(--font-12);
  margin-top: var(--space-4);
}
.technical-result-heading {
  display: flex;
  justify-content: space-between;
  gap: var(--space-4);
  flex-wrap: wrap;
}
.technical-result-heading span {
  color: var(--text-muted);
  font-size: var(--font-14);
}
pre {
  background: var(--page);
  border: 1px solid var(--border);
  padding: var(--space-4);
  border-radius: var(--radius-6);
  max-height: 540px;
  overflow: auto;
  font-size: var(--font-14);
  line-height: 1.6;
}
.technical-empty {
  padding: var(--space-16) var(--space-3);
  text-align: center;
  color: var(--text-muted);
}
</style>
