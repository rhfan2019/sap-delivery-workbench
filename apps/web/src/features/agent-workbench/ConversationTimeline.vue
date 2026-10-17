<script setup lang="ts">
import { ref } from 'vue';
import { Copy, RotateCcw, FileText } from '@lucide/vue';
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import {
  Message,
  MessageContent,
  MessageActions,
  MessageAction,
} from '@/components/ai-elements/message';
import ChatMarkdown from './ChatMarkdown.vue';
import RunSteps from './RunSteps.vue';
import type {
  AgentMessage,
  AgentArtifactRef,
} from '@sap-delivery-workbench/contracts/agent-core/types';
defineProps<{
  messages: AgentMessage[];
  busy: boolean;
  canRetry?: boolean;
  liveNote?: { text: string; at: number };
  base?: string;
  development?: boolean;
  quiet?: boolean;
  readonly?: boolean;
}>();
const emit = defineEmits<{
  retry: [];
  suggestion: [text: string];
  openArtifact: [artifact: AgentArtifactRef];
}>();
const copyNotice = ref('');
// Sections or parts the agent changed without saying why (FSD: list; development: plan and code).
function undeclared(artifact: AgentArtifactRef) {
  const c = artifact.comparison ?? {};
  if (Array.isArray(c.undeclared)) return c.undeclared as string[];
  return [...(c.plan?.undeclared ?? []), ...(c.code?.undeclared ? ['代码'] : [])];
}
// The card title is "question（background）"; the record shows the question alone.
function shortTitle(title: string, message?: AgentMessage) {
  const asked = message?.answers?.find((a) => title.startsWith(a.question))?.question;
  if (asked) return asked;
  const cut = title.indexOf('（');
  return cut > 0 && title.endsWith('）') ? title.slice(0, cut) : title;
}
function answerOf(message: AgentMessage, title: string) {
  return message.answers?.find((a) => title.startsWith(a.question))?.label;
}
const shortTime = (iso: string) =>
  new Date(iso).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
// A reply with nothing to show (a turn that only asked questions) renders no empty block.
function silent(message: AgentMessage, live: boolean) {
  return (
    !live &&
    !message.error &&
    !message.artifact &&
    message.status !== 'cancelled' &&
    !message.decision
  );
}
function hasBody(message: AgentMessage, live: boolean) {
  return (
    message.role === 'user' ||
    !!message.content ||
    (!!message.decision && message.status !== 'waiting_user') ||
    !!message.artifact ||
    !!message.error ||
    silent(message, live)
  );
}
async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    copyNotice.value = '已复制';
  } catch {
    copyNotice.value = '复制失败，请手动选择文本复制。';
  }
}
</script>
<template>
  <Conversation
    class="elements-conversation"
    aria-label="对话历史"
    :initial="true"
    resize="instant"
  >
    <ConversationContent class="elements-content">
      <Message
        v-for="(message, index) in messages"
        :key="message.id"
        :from="message.role"
        class="elements-message"
        :data-message-id="message.id"
      >
        <div
          v-if="message.role === 'user'"
          class="user-message-meta flex flex-wrap items-center justify-end gap-2 text-right text-xs text-muted-foreground"
          aria-label="发送信息"
        >
          <span>{{ message.authorName || '用户（历史姓名未记录）' }}</span>
          <time v-if="message.createdAt" :datetime="message.createdAt">{{
            new Date(message.createdAt).toLocaleString('zh-CN', { hour12: false })
          }}</time>
        </div>
        <template v-if="message.role === 'assistant' && message.runId">
          <slot v-if="busy && index === messages.length - 1" name="progress" :message="message" />
          <RunSteps
            v-else
            :steps="message.steps ?? []"
            :status="message.status"
            :run-id="message.runId"
            :model="message.model"
            :started-at="message.createdAt"
            :finished-at="message.finishedAt"
          />
        </template>
        <MessageContent
          v-if="hasBody(message, busy && index === messages.length - 1)"
          class="max-w-full"
          :class="message.role === 'assistant' ? 'w-full' : 'user-bubble'"
        >
          <!-- Answers repeat the record above: one line, the full text on demand. -->
          <details v-if="message.role === 'user' && message.answered" class="answered">
            <summary>已答复 {{ message.answered }} 个问题</summary>
            <p class="whitespace-pre-wrap break-words">{{ message.content }}</p>
          </details>
          <p v-else-if="message.role === 'user'" class="whitespace-pre-wrap break-words">
            {{ message.content }}
          </p>
          <template v-else>
            <!-- Answered questions: the question and the choice; options on demand. -->
            <section
              v-if="message.decision && message.status !== 'waiting_user'"
              class="decision-record"
              aria-label="业务问答记录"
            >
              <p class="decision-record-title">
                {{ message.answers?.length ? '已确认的问题' : '提出的问题' }}
              </p>
              <div v-for="q in message.decision.questions" :key="q.id" class="decision-record-row">
                <span>{{ shortTitle(q.title, message) }}</span>
                <strong v-if="answerOf(message, q.title)" class="decision-record-choice">{{
                  answerOf(message, q.title)
                }}</strong>
                <span v-else class="text-muted-foreground">未回答</span>
              </div>
              <details>
                <summary>查看问题说明和全部选项</summary>
                <div v-for="q in message.decision.questions" :key="q.id" class="mt-2">
                  <p>{{ q.title }}</p>
                  <ul class="my-1 space-y-1 text-muted-foreground">
                    <li v-for="o in q.options" :key="o.value">
                      {{ o.label }} — {{ o.description }}
                    </li>
                  </ul>
                </div>
              </details>
            </section>
            <ChatMarkdown
              v-if="message.content"
              :content="message.content"
              :streaming="busy && index === messages.length - 1"
            />
            <p
              v-else-if="silent(message, busy && index === messages.length - 1)"
              class="text-muted-foreground"
            >
              本轮没有文字回复
            </p>
            <button
              v-if="message.artifact"
              type="button"
              class="artifact-card"
              @click="emit('openArtifact', message.artifact)"
            >
              <span class="artifact-card-icon"><FileText class="size-5" /></span>
              <span class="artifact-card-text"
                ><strong>{{ development ? '开发方案与代码' : '功能说明书' }}</strong
                ><small>第 {{ message.artifact.revision }} 版 · 已保存</small></span
              >
              <span class="artifact-card-open">打开</span>
            </button>
            <p
              v-if="message.artifact && undeclared(message.artifact).length"
              class="text-xs text-warning"
            >
              注意：以下部分有改动但助手没有说明原因，请重点核对：{{
                undeclared(message.artifact).join('、')
              }}
            </p>
            <div
              v-if="message.error"
              class="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"
              role="alert"
            >
              <strong>本轮未完成</strong>
              <p>{{ message.error }}</p>
              <details v-if="message.runId">
                <summary>诊断详情</summary>
                <p>运行编号：{{ message.runId }}</p>
                <p v-if="message.errorCode">{{ message.errorCode }}</p>
              </details>
            </div>
          </template>
        </MessageContent>
        <p
          v-if="
            message.role === 'assistant' &&
            !busy &&
            index === messages.length - 1 &&
            message.status === 'cancelled'
          "
          role="status"
          class="text-sm text-muted-foreground"
        >
          已停止本轮运行。可补充需求后重新发送。
        </p>
        <MessageActions
          v-if="
            message.role === 'assistant' &&
            !(busy && index === messages.length - 1) &&
            (message.content || (canRetry && index === messages.length - 1))
          "
          class="items-center"
        >
          <MessageAction v-if="message.content" label="复制回复" @click="copy(message.content)"
            ><Copy class="size-4"
          /></MessageAction>
          <MessageAction
            v-if="canRetry && !busy && index === messages.length - 1"
            label="重新生成"
            :disabled="readonly"
            @click="emit('retry')"
            ><RotateCcw class="size-4"
          /></MessageAction>
          <time
            v-if="message.finishedAt"
            class="ml-1 text-xs text-muted-foreground"
            :datetime="message.finishedAt"
            >{{ shortTime(message.finishedAt) }}</time
          >
        </MessageActions>
      </Message>
      <slot />
    </ConversationContent>
    <ConversationScrollButton aria-label="滚动到最新消息" />
    <span class="sr-only" role="status">{{ copyNotice }}</span>
  </Conversation>
</template>
<style scoped>
.answered summary {
  cursor: pointer;
}
.answered p {
  margin: var(--space-2) 0 0;
  font-size: var(--font-size-sm);
  line-height: 20px;
  color: var(--muted);
}
/* DESIGN.md 6: a saved version is a compact card row that opens the result panel. */
.artifact-card {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: min(100%, 420px);
  margin-top: var(--space-1);
  padding: var(--space-2-5) var(--space-3) var(--space-2-5) var(--space-2-5);
  border: 1px solid var(--card-border);
  border-radius: var(--card-radius);
  background: var(--card-bg);
  color: var(--text);
  text-align: left;
}
.artifact-card:hover {
  border-color: var(--border-strong);
  background: var(--surface-muted);
}
.artifact-card-icon {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: var(--card-radius);
  background: var(--active);
  color: var(--link);
  flex-shrink: 0;
}
.artifact-card-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.artifact-card-text strong {
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-semibold);
}
.artifact-card-text small {
  font-size: var(--font-size-xs);
  color: var(--muted);
}
.artifact-card-open {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--link);
}
.decision-record {
  margin-bottom: var(--space-3);
  padding: var(--space-3) var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  font-size: var(--font-size-md);
}
.decision-record-title {
  margin: 0 0 var(--space-2);
  font-size: var(--font-size-xs);
  color: var(--muted);
}
.decision-record-row {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-1) var(--space-4);
  padding: var(--space-1-5) 0;
  border-top: 1px solid var(--border);
}
.decision-record-row:first-of-type {
  border-top: 0;
}
.decision-record-choice {
  padding: var(--space-0-5) var(--space-2);
  border-radius: var(--radius-sm);
  background: var(--active);
  color: var(--link);
  font-weight: var(--font-weight-medium);
  font-size: var(--font-size-sm);
}
.decision-record details {
  margin-top: var(--space-2);
  font-size: var(--font-size-sm);
}
.decision-record summary {
  cursor: pointer;
  color: var(--muted);
  font-size: var(--font-size-xs);
}
</style>
