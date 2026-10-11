<script setup lang="ts">
import { onMounted, ref } from 'vue';
import ChatMarkdown from '../abap-fsd-agent/ChatMarkdown.vue';
import { auditApi, type Proposal } from './api';

const items = ref<Proposal[]>([]),
  opened = ref<Proposal | null>(null),
  loading = ref(false),
  error = ref('');
async function load() {
  loading.value = true;
  error.value = '';
  try {
    items.value = await auditApi.proposals();
    if (items.value[0] && !opened.value) await open(items.value[0].id);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
async function open(id: string) {
  try {
    opened.value = await auditApi.proposal(id);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('zh-CN') : '');
onMounted(load);
</script>
<template>
  <p v-if="error" class="error-note" role="alert">{{ error }}</p>
  <section v-if="!loading && !items.length" class="surface audit-section">
    <h2>还没有优化建议</h2>
    <p class="muted">
      测试一段时间后，在每轮运行下写下评论，然后告诉 Claude Code
      “分析审计日志”。它会导出日志和评论、对照代码分析，并把优化建议发布到这里。
    </p>
  </section>
  <div v-else class="audit-proposals">
    <nav class="surface audit-proposal-list" aria-label="建议列表">
      <button
        v-for="p in items"
        :key="p.id"
        :class="{ active: opened?.id === p.id }"
        @click="open(p.id)"
      >
        <strong>{{ p.title }}</strong>
        <small class="muted"
          >{{ new Date(p.created_at).toLocaleString('zh-CN', { hour12: false }) }} · {{ p.author
          }}<template v-if="p.period_from">
            · {{ day(p.period_from) }}～{{ day(p.period_to) }}</template
          ><template v-if="p.sources?.runs">
            · {{ p.sources.runs }} 轮 / {{ p.sources.comments ?? 0 }} 条评论</template
          ></small
        >
      </button>
    </nav>
    <article v-if="opened" class="surface audit-section audit-proposal">
      <ChatMarkdown :content="opened.markdown ?? ''" />
    </article>
  </div>
</template>
<style scoped>
.audit-proposals {
  display: grid;
  grid-template-columns: minmax(220px, 300px) 1fr;
  gap: 16px;
  align-items: start;
}
.audit-proposal-list {
  display: flex;
  flex-direction: column;
  padding: 8px;
}
.audit-proposal-list button {
  display: flex;
  flex-direction: column;
  gap: 2px;
  text-align: left;
  padding: 10px;
  border: 0;
  background: transparent;
  border-radius: 6px;
  cursor: pointer;
}
.audit-proposal-list button.active {
  background: var(--surface-muted, #f1f5f9);
}
@media (max-width: 900px) {
  .audit-proposals {
    grid-template-columns: 1fr;
  }
}
</style>
