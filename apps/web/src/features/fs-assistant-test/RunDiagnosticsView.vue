<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../../services/session';
import { Button } from '@/components/ui/button';
const route = useRoute();
const data = ref<any>(null),
  error = ref(''),
  loading = ref(false);
const controller = new AbortController();
const base = String(route.query.base ?? '/admin/abap-fsd-agent');
async function load() {
  if (
    !/^(?:\/admin\/abap-fsd-agent|\/projects\/[a-f0-9-]{36}\/development-items\/[a-f0-9-]{36}\/work\/(?:design|development)\/agent)$/.test(
      base,
    )
  ) {
    error.value = '日志入口无效';
    return;
  }
  loading.value = true;
  error.value = '';
  try {
    data.value = await api(
      base + '/runs/' + encodeURIComponent(String(route.params.runId)) + '/diagnostics',
      undefined,
      undefined,
      { signal: controller.signal },
    );
  } catch (e) {
    if (!controller.signal.aborted) error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
const labels: Record<string, string> = {
  queued: '排队中',
  running: '运行中',
  completed: '已完成',
  failed: '失败',
  waiting_user: '等待回答',
  cancelled: '已停止',
  succeeded: '成功',
  skipped: '未执行',
};
onMounted(load);
onBeforeUnmount(() => controller.abort());
</script>
<template>
  <main class="mx-auto w-full max-w-5xl space-y-5 p-5" aria-label="运行日志">
    <header class="flex flex-wrap items-center justify-between gap-3">
      <h1 class="text-xl font-semibold">运行信息与日志</h1>
      <Button :disabled="loading" @click="load">刷新日志</Button>
    </header>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="loading" role="status">正在读取日志…</p>
    <template v-if="data">
      <dl class="space-y-2 break-all">
        <dt>运行编号</dt>
        <dd>{{ data.runId }}</dd>
        <dt>会话编号</dt>
        <dd>{{ data.conversationId }}</dd>
        <dt>开始时间 / 状态</dt>
        <dd>
          {{ new Date(data.createdAt).toLocaleString('zh-CN') }} ·
          {{ labels[data.state] || data.state }}
        </dd>
        <dt>模型</dt>
        <dd>{{ data.model?.provider }} / {{ data.model?.modelId }}</dd>
      </dl>
      <section v-if="data.failure" class="rounded border border-destructive p-3" role="alert">
        <strong>{{ data.failure.code }}</strong>
        <p>{{ data.failure.message }}</p>
        <details>
          <summary>连接与生成诊断</summary>
          <pre class="max-h-80 overflow-auto whitespace-pre-wrap break-all">{{
            JSON.stringify(
              { diagnostics: data.failure.diagnostics, attempts: data.failure.attempts },
              null,
              2,
            )
          }}</pre>
        </details>
      </section>
      <section v-if="data.validation?.valid === false" class="rounded border p-3">
        <h2 class="font-semibold">校验未通过：如何继续</h2>
        <p>
          本轮没有保存新的说明书，已有版本不受影响。返回原会话点击“重新生成”，无需重新填写需求。
        </p>
        <p>若再次出现相同错误，请将运行编号和下列错误位置交给维护人员排查，避免反复等待。</p>
        <ul class="list-inside list-disc break-all">
          <li v-for="(issue, index) in data.validation.errors" :key="index">
            {{ issue.code }} · {{ issue.path || '此历史记录未提供字段位置' }}
          </li>
        </ul>
      </section>
      <details v-if="data.generation || data.generationProgress">
        <summary>模型生成耗时与接收进度</summary>
        <pre class="max-h-80 overflow-auto whitespace-pre-wrap break-all">{{
          JSON.stringify(
            { generation: data.generation, progress: data.generationProgress },
            null,
            2,
          )
        }}</pre>
      </details>
      <section v-if="data.analysis">
        <h2 class="font-semibold">分步耗时与模型调用</h2>
        <p>
          总耗时：{{
            data.analysis.elapsedMs == null
              ? '未结束或未记录'
              : (data.analysis.elapsedMs / 1000).toFixed(1) + ' 秒'
          }}。步骤包含其内部调用，不能重复相加。
        </p>
        <table class="w-full text-left text-sm">
          <thead>
            <tr>
              <th>步骤</th>
              <th>状态</th>
              <th>耗时（秒）</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="step in data.analysis.steps" :key="step.stepId">
              <td>{{ step.label }}</td>
              <td>{{ labels[step.status] || step.status }}</td>
              <td>{{ step.durationMs == null ? '—' : (step.durationMs / 1000).toFixed(2) }}</td>
            </tr>
          </tbody>
        </table>
        <p v-if="!data.analysis.traceAvailable">此历史运行未记录结构化调用轨迹。</p>
        <table v-else class="w-full text-left text-sm">
          <thead>
            <tr>
              <th>模型调用</th>
              <th>所属步骤</th>
              <th>耗时（秒）</th>
              <th>输入 / 输出 token</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="call in data.analysis.calls" :key="call.callId">
              <td>{{ call.callId }} · {{ call.task }}</td>
              <td>{{ call.stage }}</td>
              <td>{{ call.durationMs == null ? '—' : (call.durationMs / 1000).toFixed(2) }}</td>
              <td>
                {{ call.usage?.prompt_tokens ?? '—' }} / {{ call.usage?.completion_tokens ?? '—' }}
              </td>
            </tr>
          </tbody>
        </table>
      </section>
      <section>
        <h2 class="font-semibold">执行步骤</h2>
        <p v-if="data.rendering" class="text-sm text-muted-foreground">
          JSON → Markdown：本地 JavaScript 脚本，模型调用 0 次，渲染
          {{ Number(data.rendering.durationMs).toFixed(2) }} 毫秒。
        </p>
        <ol class="space-y-3">
          <li v-for="step in data.plan?.steps" :key="step.stepId" class="rounded border p-3">
            <strong>{{ step.label }} · {{ labels[step.status] }}</strong>
            <p>{{ step.summary }}</p>
            <small>{{ step.startedAt || '尚未开始' }} → {{ step.finishedAt || '尚未结束' }}</small>
          </li>
        </ol>
      </section>
      <section>
        <h2 class="font-semibold">本轮请求</h2>
        <p class="whitespace-pre-wrap">{{ data.prompt }}</p>
      </section>
      <details>
        <summary>上下文、已确认回答与提示词版本</summary>
        <pre class="max-h-96 overflow-auto whitespace-pre-wrap break-all">{{
          JSON.stringify(data.context, null, 2)
        }}</pre>
      </details>
      <details>
        <summary>技术输出与协议检查</summary>
        <pre class="max-h-96 overflow-auto whitespace-pre-wrap break-all">{{
          data.technicalOutput
        }}</pre>
        <pre class="max-h-96 overflow-auto whitespace-pre-wrap break-all">{{
          JSON.stringify({ preflight: data.preflight, validation: data.validation }, null, 2)
        }}</pre>
      </details>
      <a v-if="data.rendered" :href="'/api' + base + '/runs/' + data.runId + '/markdown'" download
        >下载 Markdown 阅读稿</a
      >
      <p class="text-sm text-muted-foreground">
        此页展示已持久化的步骤快照；未记录的事件不补造。重置开发项后原运行日志不再可用。
      </p>
    </template>
  </main>
</template>
