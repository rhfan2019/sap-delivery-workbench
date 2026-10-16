<script setup lang="ts">
import { ref } from 'vue';
import { Copy, RotateCcw, FileText, Sparkles } from '@lucide/vue';
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
            ? '描述需求、上传 FSD 或资料，助手会查询 SAP、提出必要问题，写出开发方案和代码。'
            : '描述需求或上传资料，助手会查询 SAP、提出必要问题并编写 FSD。'
        "
      >
        <template #icon><Sparkles class="size-8" /></template>
      </ConversationEmptyState>
      <div v-if="!messages.length" class="flex flex-wrap justify-center gap-2">
        <template v-if="development">
          <Suggestion
            suggestion="请分析这个开发项的资料，先写开发方案，并列出需要我确认的问题。"
            :disabled="readonly"
            @click="emit('suggestion', $event)"
            >梳理需求并出开发方案</Suggestion
          >
          <Suggestion
            suggestion="需求已经清楚，请查询 SAP 后直接写开发方案和代码。"
            :disabled="readonly"
            @click="emit('suggestion', $event)"
            >直接写方案和代码</Suggestion
          >
        </template>
        <template v-else>
          <Suggestion
            suggestion="请分析这个开发项的需求，先找出需要客户确认的问题。"
            :disabled="readonly"
            @click="emit('suggestion', $event)"
            >梳理需求与待确认问题</Suggestion
          >
          <Suggestion
            suggestion="需求已经比较清楚，请直接查询 SAP 并起草 FSD 初稿。"
            :disabled="readonly"
            @click="emit('suggestion', $event)"
            >直接起草 FSD 初稿</Suggestion
          >
        </template>
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
        <template v-if="message.role === 'assistant' && message.runId">
          <slot v-if="busy && index === messages.length - 1" name="progress" :message="message" />
          <RunSteps
            v-else
            :steps="message.steps ?? []"
            :status="message.status"
            :run-id="message.runId"
            :started-at="message.createdAt"
            :finished-at="message.finishedAt"
          />
        </template>
        <MessageContent class="max-w-full" :class="{ 'w-full': message.role === 'assistant' }">
          <p v-if="message.role === 'user'" class="whitespace-pre-wrap break-words">
            {{ message.content }}
          </p>
          <template v-else>
            <section
              v-if="message.decision && message.status !== 'waiting_user'"
              class="rounded-lg border p-4 text-sm"
              aria-label="业务问答记录"
            >
              <strong>{{ message.answers?.length ? '已回答的问题' : '提出的问题' }}</strong>
              <div v-for="q in message.decision.questions" :key="q.id" class="mt-3">
                <p>{{ q.title }}</p>
                <ul class="my-2 space-y-1 text-muted-foreground">
                  <li v-for="o in q.options" :key="o.value">{{ o.label }} — {{ o.description }}</li>
                </ul>
                <p
                  v-if="message.answers?.find((a) => q.title.startsWith(a.question))"
                  class="font-medium"
                >
                  回答：{{ message.answers.find((a) => q.title.startsWith(a.question))?.label }}
                </p>
              </div>
            </section>
            <ChatMarkdown
              v-if="message.content"
              :content="message.content"
              :streaming="busy && index === messages.length - 1"
            />
            <p
              v-else-if="
                !(busy && index === messages.length - 1) &&
                !message.error &&
                !message.artifact &&
                message.status !== 'cancelled' &&
                !message.decision
              "
              class="text-muted-foreground"
            >
              本轮没有文字回复
            </p>
            <Artifact v-if="message.artifact" class="w-full shadow-none">
              <ArtifactHeader
                ><div class="flex items-center gap-3">
                  <FileText class="size-5" /><ArtifactTitle
                    >{{ development ? '开发方案与代码已保存' : '功能说明书已保存' }} · 第
                    {{ message.artifact.revision }} 版</ArtifactTitle
                  >
                </div></ArtifactHeader
              >
              <ArtifactContent class="space-y-3">
                <ArtifactDescription v-if="undeclared(message.artifact).length"
                  >注意：以下部分有改动但助手没有说明原因，请重点核对：{{
                    undeclared(message.artifact).join('、')
                  }}</ArtifactDescription
                >
                <ArtifactDescription v-else
                  >可在右侧“成果”中阅读；选中文字即可添加批注，让助手按批注修改。</ArtifactDescription
                >
                <Button variant="outline" size="sm" @click="emit('openArtifact', message.artifact)"
                  >{{ development ? '打开' : '打开功能说明书 · ' }}第
                  {{ message.artifact.revision }} 版</Button
                >
              </ArtifactContent>
            </Artifact>
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
        <!-- Failures, questions and saved versions already speak for themselves above. -->
        <p
          v-if="
            message.role === 'assistant' &&
            !busy &&
            index === messages.length - 1 &&
            message.status !== 'failed' &&
            message.status !== 'waiting_user' &&
            !message.artifact
          "
          role="status"
          class="rounded-lg bg-muted p-3 text-sm"
        >
          {{
            message.status === 'cancelled'
              ? '已停止本轮运行。可补充需求后重新发送。'
              : '可以继续补充需求，或提出修改意见。'
          }}
        </p>
        <MessageActions v-if="message.role === 'assistant'" class="items-center">
          <span v-if="message.status === 'cancelled'" class="text-xs text-muted-foreground"
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
