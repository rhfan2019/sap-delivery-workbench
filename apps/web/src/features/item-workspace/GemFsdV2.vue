<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { api, identity, ApiError } from '../../services/session';
import ChatMarkdown from '../fs-assistant-test/ChatMarkdown.vue';
const props = defineProps<{ base: string; editable: boolean }>();
const emit = defineEmits<{ busy: [boolean] }>();
const run = ref<any>(null),
  history = ref<any[]>([]),
  answers = ref(''),
  error = ref(''),
  sending = ref(false),
  selected = ref('');
const pending = ref<any>(null);
const key = `gem-v2:${identity.value?.organization.id}:${identity.value?.user.id}:${props.base}`;
const running = computed(() => run.value?.state === 'running');
const labels: Record<string, string> = {
  running: '生成中',
  completed: '完整文档已保存',
  waiting_user: '需要业务回答',
  failed: '运行失败',
  cancelled: '已停止',
  interrupted: '运行中断',
};
let timer: ReturnType<typeof setTimeout> | undefined,
  disposed = false;
function download(text: string, name: string, type = 'text/markdown') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function setRun(value: any) {
  if (disposed) return;
  run.value = value;
  selected.value = value.runId;
  if (pending.value?.requestId === value.runId) {
    pending.value = null;
    localStorage.removeItem(key);
  }
  emit('busy', value.state === 'running' || sending.value);
}
async function refresh() {
  try {
    history.value = (await api<any>(props.base + '/runs')).items;
    const id = selected.value || pending.value?.requestId || history.value[0]?.runId;
    if (id) setRun(await api<any>(props.base + '/runs/' + id));
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    if (!disposed) {
      clearTimeout(timer);
      timer = setTimeout(refresh, 2000);
    }
  }
}
async function start(continueRun = false) {
  sending.value = true;
  emit('busy', true);
  error.value = '';
  try {
    if (!pending.value) {
      pending.value = {
        requestId: crypto.randomUUID(),
        prompt: '依据本开发项基本信息生成完整FSD',
        answers: answers.value,
        ...(continueRun ? { parentId: run.value.runId } : {}),
      };
      localStorage.setItem(key, JSON.stringify(pending.value));
    }
    setRun(await api(props.base + '/runs', pending.value));
    pending.value = null;
    localStorage.removeItem(key);
    answers.value = '';
  } catch (e) {
    if (e instanceof ApiError && [400, 401, 403, 409, 413, 422].includes(e.status)) {
      pending.value = null;
      localStorage.removeItem(key);
      error.value = e.message + '。本次请求未启动，请修正后重新提交。';
    } else {
      error.value =
        (e as Error).message + '。请求编号已保留；可用“恢复本次请求”确认结果，不会重复调用模型。';
    }
  } finally {
    sending.value = false;
    emit('busy', running.value);
    await refresh();
  }
}
async function cancel() {
  try {
    setRun(await api(props.base + '/runs/' + run.value.runId + '/cancel', {}));
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function trace() {
  try {
    download(
      JSON.stringify(await api(props.base + '/runs/' + run.value.runId + '/trace'), null, 2),
      run.value.runId + '.json',
      'application/json',
    );
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(() => {
  try {
    pending.value = JSON.parse(localStorage.getItem(key) || 'null');
  } catch {}
  void refresh();
});
onBeforeUnmount(() => {
  disposed = true;
  clearTimeout(timer);
});
</script>
<template>
  <section class="gem-v2" aria-label="Gem FSD v2 试用">
    <h2>Gem FSD v2 · 需求到 FSD</h2>
    <p>
      使用默认模型，每轮仅生成一次，最长 360 秒。仅读取基本信息和下方补充；不读取旧版对话、附件或
      DDIC，不调用 MCP。
    </p>
    <p>成果独立保存，不覆盖旧版说明书。章节检查通过不代表业务审批或 SAP 对象已核实。</p>
    <label
      >历史运行
      <select v-model="selected" :disabled="running || sending" @change="refresh">
        <option value="">选择运行</option>
        <option v-for="h in history" :key="h.runId" :value="h.runId">
          {{ new Date(h.createdAt).toLocaleString() }} · {{ labels[h.state] }}
        </option>
      </select></label
    >
    <p v-if="error" role="alert">{{ error }}</p>
    <template v-if="run">
      <p role="status">
        <strong>{{ labels[run.state] }}</strong> ·
        {{ Math.round((run.snapshot.elapsedMs || run.snapshot.progress?.elapsedMs || 0) / 1000) }}
        秒 · {{ run.snapshot.progress?.textCharacters || 0 }} 字符
      </p>
      <p v-if="run.snapshot.failure">
        {{
          run.snapshot.failure.message
        }}。请下载日志检查原因，修订补充后手动发起新运行；系统不会自动重试。
      </p>
      <ul v-if="run.state === 'waiting_user'">
        <li v-for="q in run.snapshot.questions" :key="q.id">{{ q.question }}（{{ q.impact }}）</li>
      </ul>
      <button v-if="running" :disabled="!editable" @click="cancel">停止本次运行</button>
      <button @click="trace">下载完整日志（含业务资料）</button>
      <button v-if="run.markdown" @click="download(run.markdown, run.runId + '.md')">
        下载说明书 Markdown
      </button>
      <ChatMarkdown v-if="run.markdown" :content="run.markdown" />
    </template>
    <label
      >业务补充 / 澄清回答<textarea
        v-model="answers"
        maxlength="16000"
        rows="5"
        :disabled="running || sending || !!pending"
        placeholder="填写业务规则、预置答案及明确的测试假设"
      />
    </label>
    <button
      :disabled="!editable || running || sending"
      @click="start(run?.state === 'waiting_user')"
    >
      {{
        pending ? '恢复本次请求' : run?.state === 'waiting_user' ? '提交回答并继续' : '新建独立运行'
      }}
    </button>
    <button @click="refresh">刷新状态</button>
  </section>
</template>
<style scoped>
.gem-v2 {
  padding: 20px;
  overflow: auto;
  line-height: 1.6;
}
.gem-v2 label {
  display: block;
  margin: 16px 0;
}
.gem-v2 textarea {
  display: block;
  width: 100%;
  box-sizing: border-box;
}
.gem-v2 button {
  margin: 6px;
  padding: 8px 12px;
}
.gem-v2 select {
  max-width: 100%;
}
.gem-v2 [role='alert'] {
  color: #a4262c;
}
</style>
