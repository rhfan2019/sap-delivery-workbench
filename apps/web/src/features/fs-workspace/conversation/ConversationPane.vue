<script setup lang="ts">
import { ref } from 'vue';
import type { Message, Run, MessageCreate, AgentArtifact } from '../api';
const intent = defineModel<MessageCreate['intent']>('intent', { default: 'analyze' });
defineProps<{
  messages: Message[];
  artifacts: AgentArtifact[];
  run: Run | null;
  disabled: boolean;
  send: (text: string) => Promise<boolean>;
}>();
defineEmits<{ cancel: []; resume: []; inspect: [artifact: AgentArtifact] }>();
const reasons: Record<string, string> = {
  MODEL_CONFIGURATION_REQUIRED: '请管理员配置默认模型，并在模型管理中执行 FS 结构化测试，然后重试。',
  MODEL_CAPABILITY_REQUIRED: '模型结构化能力未验证或已过期，请重新执行 FS 结构化测试。',
  MODEL_AUTH_FAILED: '模型认证失败，请管理员检查密钥。',
  MODEL_REFUSAL: '模型拒绝本次请求，请调整输入后重新发送。',
  MODEL_TIMEOUT: '模型请求超时，可以重试。',
  MODEL_RATE_LIMITED: '模型服务限流，请稍后重试。',
  OUTPUT_TRUNCATED: '模型输出被截断，请提高输出上限或缩小本次范围。',
  CONTEXT_STALE: '文档或业务输入已变化，请基于当前内容重新发送消息。',
  CONTEXT_BUDGET_EXCEEDED: '本次上下文超出预算，请缩小材料或会话范围。',
  SAP_EVIDENCE_REQUIRED: '需要真实 SAP 证据，当前阶段已暂停；不会将推测标为已验证。',
  ATTACHMENT_NOT_READY: '附件尚未安全解析，请完成扫描和解析后重新发送。',
  AGENT_NEEDS_INPUT: '请根据回复补充业务信息后重新发送。',
  SCHEMA_INVALID: '模型输出不符合阶段契约，未产生可应用候选。',
  REFERENCE_INVALID: '模型引用了不在本次上下文中的内容，候选已拒绝。',
};
const content = ref(''),
  composing = ref(false);
async function submit(send: (text: string) => Promise<boolean>) {
  if (composing.value || !content.value.trim()) return;
  const original = content.value;
  if ((await send(original)) && content.value === original) content.value = '';
}
function keydown(event: KeyboardEvent, send: (text: string) => Promise<boolean>) {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && !composing.value) {
    event.preventDefault();
    void submit(send);
  }
}
</script>
<template>
  <section class="fs-conversation" aria-label="FS 对话">
    <h2>业务讨论</h2>
    <p class="fs-muted">消息会保存到当前项目。候选内容需人工审阅后才能进入文档。</p>
    <ol class="fs-messages">
      <li v-for="message in messages" :key="message.id">
        <strong>{{ message.role === 'user' ? '业务输入' : '工作区回复' }}</strong>
        <p>{{ message.content }}</p>
      </li>
    </ol>
    <p v-if="run" role="status">
      任务：{{
        run.status === 'waiting_evidence'
          ? '等待所需能力或证据'
          : run.status === 'cancelled'
            ? '已取消'
            : run.status === 'completed'
              ? '已完成'
              : run.status === 'running'
                ? '正在处理'
                : run.status === 'queued'
                  ? '已排队'
                  : '需要处理'
      }} · 阶段：{{ run.node_id }}
      <span v-if="run.error_code">。{{ reasons[run.error_code] ?? '任务暂停，请检查运行条件后重试。' }}（{{ run.error_code }}）</span>
    </p>
    <button v-if="run && ['waiting_evidence', 'failed'].includes(run.status)" :disabled="disabled" @click="$emit('resume')">重试当前阶段</button>
    <ul v-if="artifacts.some(a => a.change_set_id)" aria-label="Agent 候选">
      <li v-for="artifact in artifacts.filter(a => a.change_set_id)" :key="artifact.id">
        <button :disabled="disabled" @click="$emit('inspect', artifact)">审阅 {{ artifact.stage }} 候选</button>
      </li>
    </ul>
    <button
      v-if="run && ['queued', 'running', 'waiting_evidence'].includes(run.status)"
      :disabled="disabled"
      @click="$emit('cancel')"
    >
      取消当前任务
    </button>
    <form @submit.prevent="submit(send)">
      <label for="fs-intent">本次目标</label>
      <select id="fs-intent" v-model="intent" :disabled="disabled">
        <option value="analyze">分析需求</option><option value="clarify">澄清业务</option>
        <option value="generate">生成 FS 草稿候选</option><option value="revise">修改已有内容</option>
        <option value="explain">解释与检查</option>
      </select>
      <label for="fs-message">补充业务要求</label
      ><textarea
        id="fs-message"
        v-model="content"
        rows="5"
        maxlength="20000"
        :disabled="disabled"
        @compositionstart="composing = true"
        @compositionend="composing = false"
        @keydown="keydown($event, send)"
      />
      <p class="fs-muted">Enter 发送，Shift+Enter 换行。</p>
      <button class="primary" :disabled="disabled || !content.trim() || composing">发送</button>
    </form>
  </section>
</template>
