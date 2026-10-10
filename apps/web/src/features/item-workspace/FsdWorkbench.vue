<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { api } from '../../services/session';
import { renderFsdMarkdown } from '@sap-delivery-workbench/contracts/design-assistant/fsd-report-render';
import MessageResponse from '@/components/ai-elements/message/MessageResponse.vue';
const props = defineProps<{ base: string; editable: boolean }>();
const task = ref<any>(null),
  tasks = ref<any[]>([]),
  models = ref<any[]>([]),
  modelId = ref(''),
  mode = ref('SYNTHETIC'),
  target = ref(''),
  text = ref(''),
  error = ref(''),
  busy = ref(false),
  diagnostic = ref<any>(null),
  answer = ref(''),
  other = ref('');
const base = props.base + '/fsd/v1';
let stream: EventSource | undefined;
let epoch = 0;
let disposed = false;
const phases = ['接收理解', '业务分析', '方案核实', '方案确认', 'FSD编制检查', 'FSD确认', '交付'];
const question = computed(() =>
  task.value?.wait_reason === 'CLARIFICATION'
    ? task.value.wait?.questions?.find((q: any) => !task.value.answers[q.id])
    : null,
);
const artifact = computed(() => task.value?.artifacts?.at(-1));
// Artifacts before the fsd-report document model hold chapter objects; show those as they were.
const artifactMarkdown = computed(() => {
  const a = artifact.value as any;
  if (!a) return '';
  if (a.document) return renderFsdMarkdown(a.document);
  return Object.values(a.objects ?? {})
    .sort((x: any, y: any) => x.section - y.section)
    .map((o: any) => `## 第 ${o.section} 章\n\n${o.content}`)
    .join('\n\n');
});
async function operation(fn: () => Promise<void>) {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    await fn();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
async function list() {
  const result = await api<any>(base + '/tasks');
  tasks.value = result.items;
}
async function select(id: string) {
  const ticket = ++epoch;
  stream?.close();
  const next = await api<any>(base + '/tasks/' + id);
  if (disposed || ticket !== epoch) return;
  task.value = next;
  diagnostic.value = null;
  answer.value = '';
  other.value = '';
  let cursor = '0';
  stream = new EventSource('/api' + base + '/tasks/' + id + '/stream');
  stream.addEventListener('progress', async (event) => {
    const e = event as MessageEvent;
    if (BigInt(e.lastEventId || '0') <= BigInt(cursor)) return;
    cursor = e.lastEventId;
    try {
      const state = await api<any>(base + '/tasks/' + id);
      if (!disposed && ticket === epoch && (!task.value || state.revision >= task.value.revision))
        task.value = state;
    } catch (err) {
      if (ticket === epoch) error.value = (err as Error).message;
    }
  });
}
async function command(command: string, extra: Record<string, unknown> = {}) {
  await operation(async () => {
    task.value = await api(base + '/tasks/' + task.value.id + '/commands', {
      request_id: crypto.randomUUID(),
      revision: task.value.revision,
      command,
      ...extra,
    });
    answer.value = '';
    other.value = '';
    await list();
  });
}
async function create() {
  await operation(async () => {
    const next = await api<any>(base + '/tasks', {
      request_id: crypto.randomUUID(),
      text: text.value,
      mode: mode.value,
      ...(mode.value === 'REAL'
        ? { model_id: modelId.value, target: { target_ref: target.value } }
        : {}),
    });
    text.value = '';
    await list();
    await select(next.id);
  });
}
async function reset() {
  await command('reset');
  if (!error.value) {
    stream?.close();
    task.value = null;
  }
}
async function upload(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  if (file.size > 20 * 1024 * 1024) {
    error.value = '文件不能超过20MB';
    return;
  }
  await operation(async () => {
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    await api(base + '/tasks/' + task.value.id + '/attachments', {
      name: file.name,
      media_type: file.type,
      base64,
      revision: task.value.revision,
    });
    task.value = await api(base + '/tasks/' + task.value.id);
  });
}
onMounted(async () => {
  await operation(async () => {
    await list();
    models.value = (await api<any>(base + '/models')).items;
    if (tasks.value[0]) await select(tasks.value[0].id);
  });
});
onBeforeUnmount(() => {
  disposed = true;
  epoch++;
  stream?.close();
});
</script>
<template>
  <section aria-label="FSD设计助手" class="work-document">
    <div class="work-actions">
      <label
        >任务历史<select
          :value="task?.id || ''"
          :disabled="busy"
          @change="operation(() => select(($event.target as HTMLSelectElement).value))"
        >
          <option value="" disabled>选择任务</option>
          <option v-for="t in tasks" :key="t.id" :value="t.id">
            {{ new Date(t.created_at).toLocaleString() }} · {{ t.status }}
          </option>
        </select></label
      ><button :disabled="busy || !task" @click="operation(() => select(task.id))">刷新状态</button
      ><button :disabled="busy || !editable || !task" @click="command('new_session')">
        新建对话</button
      ><button :disabled="busy || !editable || !task" @click="reset">重置（保留历史）</button>
    </div>
    <p v-if="error" role="alert" class="work-error">{{ error }}</p>
    <template v-if="task">
      <p role="status">
        阶段 {{ task.phase }}/7 · {{ phases[task.phase - 1] }} · {{ task.status }}
        {{ task.wait_reason || '' }}
      </p>
      <p v-if="task.mode === 'SYNTHETIC'" class="work-inline-note">
        合成测试模式：ZPOC 为测试伪对象，成果不能作为真实 SAP 开发依据。
      </p>
      <div class="work-actions">
        <button :disabled="busy || !editable || task.status !== 'ACTIVE'" @click="command('pause')">
          暂停</button
        ><button
          :disabled="busy || !editable || !['PAUSED', 'WAITING'].includes(task.status)"
          @click="command(task.status === 'PAUSED' ? 'resume' : 'recover')"
        >
          继续 / 恢复</button
        ><button
          :disabled="busy || !editable || ['ENDED', 'DELIVERED'].includes(task.status)"
          @click="command('cancel')"
        >
          取消执行</button
        ><button
          @click="
            operation(async () => {
              diagnostic = await api(base + '/tasks/' + task.id + '/diagnostics');
            })
          "
        >
          运行诊断</button
        ><a
          :href="'/api' + base + '/tasks/' + task.id + '/diagnostics'"
          target="_blank"
          rel="noopener"
          >诊断包</a
        >
      </div>
      <div v-if="question">
        <p>
          本批共 {{ task.wait.questions.length }} 题，当前第
          {{ task.wait.questions.findIndex((q: any) => q.id === question.id) + 1 }}/{{
            task.wait.questions.length
          }}
          题
        </p>
        <h3>{{ question.question }}</h3>
        <p>{{ question.background }}</p>
        <label v-for="o in question.options" :key="o.id"
          ><input type="radio" v-model="answer" :value="o.id" :disabled="busy || !editable" />{{
            o.label
          }}
          {{ o.recommended ? '（推荐）' : '' }} — {{ o.impact }}</label
        ><textarea
          v-model="other"
          placeholder="选择其他时请补充说明"
          aria-label="补充说明"
        /><button
          :disabled="!answer || busy || !editable"
          @click="
            command('answer', {
              question_id: question.id,
              option_id: answer,
              text: other,
              attachment_ids: task.attachment_ids,
            })
          "
        >
          保存答案
        </button>
      </div>
      <button
        v-else-if="task.wait_reason === 'CLARIFICATION'"
        :disabled="busy || !editable"
        @click="command('complete_batch')"
      >
        提交完整回答批次
      </button>
      <template v-if="artifact"
        ><h3>{{ artifact.kind === 'PLAN' ? '业务方案' : '功能规格' }} · v{{ artifact.version }}</h3>
        <MessageResponse :content="artifactMarkdown" />
        <div class="work-actions">
          <a
            :href="
              '/api' + base + '/tasks/' + task.id + '/artifacts/' + artifact.id + '?format=docx'
            "
            >下载 DOCX</a
          ><a :href="'/api' + base + '/tasks/' + task.id + '/artifacts/' + artifact.id"
            >结构化 JSON</a
          ><button
            v-if="
              ['PLAN_CONFIRM', 'FSD_CONFIRM'].includes(task.wait_reason) &&
              task.wait?.status === 'OPEN'
            "
            :disabled="busy || !editable"
            @click="
              command('confirm', {
                artifact_id: task.wait.artifact_id,
                artifact_version: task.wait.artifact_version,
                scope: task.wait.scope,
                confirmed: true,
              })
            "
          >
            确认当前{{ task.wait_reason === 'PLAN_CONFIRM' ? '方案' : 'FSD' }}及范围
          </button>
        </div></template
      >
      <label
        >添加附件（最大20MB）<input
          type="file"
          :disabled="busy || !editable"
          accept=".txt,.md,.csv,.json,.xml,.abap,.pdf,.docx,.xlsx,.png,.jpg,.jpeg"
          @change="upload"
      /></label>
      <form
        @submit.prevent="
          command('supplement', { text }).then(() => {
            if (!error) text = '';
          })
        "
      >
        <textarea
          v-model="text"
          aria-label="补充需求"
          placeholder="补充需求或修改意见"
          :disabled="!editable"
        /><button :disabled="busy || !editable || !text.trim()">提交补充</button>
      </form>
      <details v-if="diagnostic" open>
        <summary>诊断时间线</summary>
        <p>
          Trace {{ diagnostic.observation.degraded ? '降级或未启用' : '已启用' }}；SAP
          内部执行未覆盖。
        </p>
        <ol>
          <li v-for="e in diagnostic.timeline" :key="e.id">
            {{ e.at }} · {{ e.event_type }} · {{ e.refs.error_code || e.refs.node_id || '' }}
          </li>
        </ol>
        <pre>{{ JSON.stringify(diagnostic.runs, null, 2) }}</pre>
      </details>
    </template>
    <form v-else @submit.prevent="create">
      <h3>新建 FSD 任务</h3>
      <label
        >运行模式<select v-model="mode">
          <option value="SYNTHETIC">合成工程验证</option>
          <option value="REAL">真实模型 / SAP（须完成接入登记）</option>
        </select></label
      ><template v-if="mode === 'REAL'"
        ><label
          >模型<select v-model="modelId">
            <option v-for="m in models" :key="m.id" :value="m.id">{{ m.name }}</option>
          </select></label
        ><label>已登记目标<input v-model="target" /></label></template
      ><textarea v-model="text" aria-label="报表需求" placeholder="描述报表需求" /><button
        class="work-primary"
        :disabled="busy || !editable || !text.trim()"
      >
        开始设计
      </button>
    </form>
  </section>
</template>
