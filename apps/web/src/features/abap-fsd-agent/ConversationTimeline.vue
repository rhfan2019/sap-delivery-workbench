<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { Copy, RotateCcw, FileText, Sparkles, LoaderCircle } from '@lucide/vue';
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import {
  Message,
  MessageContent,
  MessageActions,
  MessageAction,
} from '@/components/ai-elements/message';
import {
  Artifact,
  ArtifactHeader,
  ArtifactTitle,
  ArtifactDescription,
  ArtifactContent,
} from '@/components/ai-elements/artifact';
import { Suggestion } from '@/components/ai-elements/suggestion';
import { Button } from '@/components/ui/button';
import ChatMarkdown from './ChatMarkdown.vue';
import RunSteps from './RunSteps.vue';
import type {
  AgentMessage,
  AgentArtifact,
} from '@sap-delivery-workbench/contracts/abap-fsd-agent/types';
defineProps<{
  messages: AgentMessage[];
  busy: boolean;
  statusLabel: string;
  canRetry?: boolean;
  generationNote?: string;
  base?: string;
  development?: boolean;
  quiet?: boolean;
  readonly?: boolean;
}>();
const emit = defineEmits<{
  retry: [];
  suggestion: [text: string];
  openArtifact: [artifact: AgentArtifact];
}>();
const copyNotice = ref('');
const now = ref(Date.now());
let ticker: ReturnType<typeof setInterval>;
onMounted(() => {
  ticker = setInterval(() => {
    now.value = Date.now();
  }, 1000);
});
onBeforeUnmount(() => clearInterval(ticker));
function elapsed(message: AgentMessage, running: boolean) {
  if (!message.createdAt || (!running && !message.finishedAt)) return '耗时未记录';
  const seconds = Math.max(
    0,
    Math.floor(
      ((running ? now.value + (message.clockOffsetMs ?? 0) : Date.parse(message.finishedAt!)) -
        Date.parse(message.createdAt)) /
        1000,
    ),
  );
  return Number.isFinite(seconds)
    ? `耗时 ${Math.floor(seconds / 60)}分${seconds % 60}秒`
    : '耗时未记录';
}
const structured = (content: string) => /^\s*(?:```(?:json)?\s*)?[\[{]/i.test(content);
function logs(base: string | undefined, id: string) {
  return (
    '/workspace/assistant-runs/' +
    id +
    '?base=' +
    encodeURIComponent(base || '/admin/abap-fsd-agent')
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
      <ConversationEmptyState
        v-if="!messages.length"
        class="min-h-56"
        :title="development ? '一起完成开发' : '一起把需求说明白'"
        :description="
          development
            ? '依据已保存的设计，讨论技术方案与代码。'
            : '从业务需求开始，逐步形成可核验的功能说明书。'
        "
      >
        <template #icon><Sparkles class="size-8" /></template>
      </ConversationEmptyState>
      <div v-if="!messages.length" class="flex flex-wrap justify-center gap-2">
        <Suggestion
          suggestion="请帮我梳理这个开发项的需求，先找出需要确认的问题。"
          :disabled="readonly"
          @click="emit('suggestion', $event)"
          >梳理需求与待确认问题</Suggestion
        >
        <Suggestion
          suggestion="请根据关联开发项的需求，分析SAP对象与测试场景。"
          :disabled="readonly"
          @click="emit('suggestion', $event)"
          >分析 SAP 对象与测试场景</Suggestion
        >
      </div>
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
        <div
          v-if="message.role === 'assistant'"
          class="flex items-center gap-2 text-xs text-muted-foreground"
        >
          <Sparkles class="size-4" /><span>{{
            development ? '开发助手' : quiet ? '设计助手' : 'FS 助手'
          }}</span
          ><span>{{ message.model }}</span>
        </div>
        <div
          v-if="message.role === 'assistant' && message.runId"
          class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
          aria-label="运行信息"
        >
          <span class="break-all">运行编号：{{ message.runId }}</span>
          <Button variant="ghost" size="sm" @click="copy(message.runId)">复制编号</Button>
          <a :href="logs(base, message.runId)" target="_blank" rel="noopener">查看日志</a>
          <time v-if="message.createdAt">{{
            new Date(message.createdAt).toLocaleString('zh-CN', { hour12: false })
          }}</time>
          <span>{{ elapsed(message, busy && index === messages.length - 1) }}</span>
        </div>
        <template v-if="message.role === 'assistant'">
          <slot v-if="index === messages.length - 1" name="progress" />
          <RunSteps v-else :steps="message.steps ?? []" />
        </template>
        <MessageContent class="max-w-full" :class="{ 'w-full': message.role === 'assistant' }">
          <p v-if="message.role === 'user'" class="whitespace-pre-wrap break-words">
            {{ message.content }}
          </p>
          <template v-else>
            <p
              v-if="
                !message.artifact &&
                /\b(?:BAPI_[A-Z0-9_]+|[A-Z]{3,10}-[A-Z]{3,10})\b/.test(message.content)
              "
              class="text-xs text-muted-foreground"
            >
              本回复包含技术对象候选；未附核验证据的名称、签名及适用性均待 SAP 核验。
            </p>
            <section v-if="message.rendered" class="space-y-2">
              <p>需求讨论阅读稿 · 尚未保存为可确认的 FSD 版本。请继续生成初稿后审阅确认。</p>
              <a :href="'/api' + base + '/runs/' + message.runId + '/markdown'" download
                >下载 Markdown 文件</a
              >
              <ChatMarkdown :content="message.rendered.markdown" />
              <details v-if="message.content" class="text-xs text-muted-foreground">
                <summary>技术详情（原始 JSON）</summary>
                <pre class="max-h-80 overflow-auto whitespace-pre-wrap break-all">{{
                  message.content
                }}</pre>
              </details>
            </section>
            <section
              v-else-if="message.decision"
              class="rounded-lg border p-4 text-sm"
              aria-label="业务问答记录"
            >
              <strong>{{
                message.answers?.length ? '已回答的业务问题' : '待回答的业务问题'
              }}</strong>
              <p v-if="message.status === 'waiting_user'" class="mt-1 text-muted-foreground">
                请使用下方选项确认，无需逐项输入。
              </p>
              <div
                v-for="q in message.status === 'waiting_user' ? [] : message.decision.questions"
                :key="q.id"
                class="mt-3"
              >
                <p>{{ q.title }}</p>
                <ul class="my-2 space-y-1 text-muted-foreground">
                  <li v-for="o in q.options" :key="o.value">{{ o.label }} — {{ o.description }}</li>
                </ul>
                <p v-if="message.answers?.find((a) => a.question === q.title)" class="font-medium">
                  回答：{{ message.answers.find((a) => a.question === q.title)?.label }}
                </p>
              </div>
              <time v-if="message.answeredAt" class="text-xs text-muted-foreground">{{
                new Date(message.answeredAt).toLocaleString('zh-CN')
              }}</time>
            </section>
            <Artifact
              v-else-if="message.action === 'draft' && message.status !== 'waiting_user'"
              class="w-full shadow-none"
            >
              <ArtifactHeader
                ><div class="flex items-center gap-3">
                  <FileText class="size-5" /><ArtifactTitle>{{
                    busy && index === messages.length - 1
                      ? '正在处理交付任务'
                      : message.artifact
                        ? development
                          ? '开发候选已生成'
                          : '功能说明书候选已生成'
                        : '本次交付物尚未完成'
                  }}</ArtifactTitle>
                </div></ArtifactHeader
              >
              <ArtifactContent class="space-y-3">
                <ArtifactDescription>{{
                  busy && index === messages.length - 1
                    ? generationNote || statusLabel
                    : message.artifact
                      ? '结构化校验已通过，可打开审阅后采用到开发项。'
                      : '已有内容保留，未将不完整草稿发布为正式版本。'
                }}</ArtifactDescription>
                <Button
                  v-if="message.artifact"
                  variant="outline"
                  size="sm"
                  @click="emit('openArtifact', message.artifact)"
                  >打开{{ development ? '开发内容' : '功能说明书' }} · v{{
                    message.artifact.revision
                  }}</Button
                >
              </ArtifactContent>
            </Artifact>
            <p v-else-if="message.status === 'waiting_user'" class="text-muted-foreground">
              等待确认 · 请使用下方选项继续
            </p>
            <details
              v-else-if="message.content && structured(message.content)"
              class="rounded-lg border p-3 text-sm"
            >
              <summary>
                {{
                  busy && index === messages.length - 1 ? '正在接收结构化内容…' : '技术输出（JSON）'
                }}
              </summary>
              <pre class="max-h-80 overflow-auto whitespace-pre-wrap break-all">{{
                message.content
              }}</pre>
            </details>
            <ChatMarkdown
              v-else-if="message.content"
              :content="message.content"
              :streaming="busy && index === messages.length - 1"
            />
            <div
              v-else-if="!message.error && message.status !== 'cancelled'"
              class="flex items-center gap-2 text-muted-foreground"
            >
              <LoaderCircle
                v-if="busy && index === messages.length - 1"
                class="size-4 animate-spin"
              />{{
                busy && index === messages.length - 1
                  ? generationNote || '正在准备回复…'
                  : '未收到模型正文'
              }}
            </div>
            <details
              v-if="
                message.action === 'draft' &&
                message.content &&
                !message.artifact &&
                !message.decision
              "
              class="text-xs text-muted-foreground"
            >
              <summary>查看未完成输出</summary>
              <ChatMarkdown :content="message.content" />
            </details>
            <div
              v-if="message.error"
              class="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"
              role="alert"
            >
              <strong>{{
                message.errorCode === 'OUTPUT_LIMIT' ? '输出达到额度上限' : '本次生成未完成'
              }}</strong>
              <p>{{ message.error }}</p>
              <details v-if="message.runId">
                <summary>诊断详情</summary>
                <p>运行编号：{{ message.runId }}</p>
                <p>{{ message.errorCode }} · {{ message.finishReason }}</p>
              </details>
            </div>
          </template>
        </MessageContent>
        <p
          v-if="message.role === 'assistant' && !busy && index === messages.length - 1"
          role="status"
          class="rounded-lg bg-muted p-3 text-sm"
        >
          {{
            message.status === 'failed'
              ? '本轮未完成，已保留原需求。请查看日志，修正后重试。'
              : message.status === 'cancelled'
                ? '已停止本轮运行。可补充需求后重新发送。'
                : message.status === 'waiting_user'
                  ? '已完成当前需求分析。请回答下方业务问题后继续。'
                  : message.artifact
                    ? '已生成并保存候选成果。请打开审阅，点击“采用”更新工作稿，或回复具体修改意见。'
                    : message.content && structured(message.content)
                      ? '本轮回复只有技术输出，没有完成讨论。请重试，或补充说明后重新发送。'
                      : message.rendered
                        ? '已完成可读文档转换。可下载 Markdown；阅读稿不会自动覆盖当前成果。'
                        : development
                          ? '已完成本轮开发讨论。可继续补充，或回复“生成开发内容”进入下一步。'
                          : '已完成本轮需求讨论。可继续补充，或回复“生成FSD”进入草稿生成。'
          }}
        </p>
        <MessageActions v-if="message.role === 'assistant'" class="items-center">
          <span
            v-if="busy && index === messages.length - 1"
            class="text-xs text-muted-foreground"
            role="status"
            >{{ generationNote || statusLabel }}</span
          >
          <span v-else-if="message.status === 'cancelled'" class="text-xs text-muted-foreground"
            >已停止，内容已保留</span
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
        </MessageActions>
      </Message>
      <slot />
    </ConversationContent>
    <ConversationScrollButton aria-label="滚动到最新消息" />
    <span class="sr-only" role="status">{{ copyNotice }}</span>
  </Conversation>
</template>
