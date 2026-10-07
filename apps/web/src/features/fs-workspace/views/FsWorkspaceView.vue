<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { useFsWorkspace } from '../state/useFsWorkspace';
import ConversationPane from '../conversation/ConversationPane.vue';
import DocumentPane from '../document/DocumentPane.vue';
import ChangeSetReview from '../changes/ChangeSetReview.vue';
import AttachmentDrawer from '../evidence/AttachmentDrawer.vue';
import ExportDialog from '../review/ExportDialog.vue';
import '../workspace.css';
const route = useRoute();
const state = useFsWorkspace(String(route.params.projectId), String(route.params.itemId));
const { snapshot, document, messages, run, change, busy, error, loading } = state;
const pane = ref('document');
onMounted(state.initialize);
</script>
<template>
  <main class="fs-workspace" :aria-busy="busy || loading">
    <header class="fs-toolbar">
      <div>
        <p class="fs-muted">FS 智能工作区</p>
        <h1>{{ snapshot?.workspace?.fs_number ?? '功能规格说明' }}</h1>
      </div>
      <div class="fs-actions">
        <button :disabled="busy" @click="state.refresh">刷新</button
        ><button
          v-if="snapshot?.workspace"
          :disabled="busy || !snapshot.capabilities.can_edit"
          @click="state.save"
        >
          保存版本</button
        ><RouterLink to="/workspace/development-items">返回开发项</RouterLink>
      </div>
    </header>
    <p v-if="error" role="alert" class="fs-error">{{ error }} 输入未提交成功时请保留内容后重试。</p>
    <p v-if="loading" role="status">正在加载授权工作区…</p>
    <section v-else-if="snapshot && !snapshot.workspace" class="fs-empty">
      <h2>开始结构化编写</h2>
      <p>启用后会保留历史 FS，并将后续修改纳入版本与确认流程。</p>
      <button
        class="primary"
        :disabled="busy || !snapshot.capabilities.can_edit"
        @click="state.create"
      >
        启用 FS 工作区
      </button>
    </section>
    <template v-else-if="snapshot?.workspace"
      ><p class="fs-muted">
        当前草稿：修订 {{ snapshot.workspace.draft_head?.revision }} · 当前依据版本：{{
          snapshot.workspace.baseline_head?.formal_number ?? '暂无'
        }}
        · {{ snapshot.capabilities.can_edit ? '可编辑' : '只读' }}
      </p>
      <nav class="fs-pane-switch" aria-label="工作区区域">
        <button :aria-pressed="pane === 'conversation'" @click="pane = 'conversation'">对话</button
        ><button :aria-pressed="pane === 'document'" @click="pane = 'document'">文档</button>
      </nav>
      <ChangeSetReview
        v-if="change"
        :change="change"
        :document="document"
        :busy="busy"
        @accept="state.accept"
        @reject="state.reject"
      />
      <AttachmentDrawer
        :attachments="state.attachments.value"
        :editable="snapshot.capabilities.can_edit"
        :busy="busy"
        :base="`/projects/${route.params.projectId}/development-items/${route.params.itemId}/fs-workspace`"
        :upload="state.upload"
        @parse="state.parse"
      />
      <ExportDialog
        :result="state.exportResult.value"
        :revision="state.exportRevision.value"
        :busy="busy"
        :enabled="snapshot.capabilities.can_export"
        :base="`/projects/${route.params.projectId}/development-items/${route.params.itemId}/fs-workspace`"
        @create="state.requestExport"
        @refresh="state.refreshExport"
      />
      <div class="fs-panes" :data-pane="pane">
        <ConversationPane
          v-model:intent="state.intent.value"
          :artifacts="state.artifacts.value"
          :messages="messages"
          :run="run"
          :disabled="busy || !snapshot.capabilities.can_edit"
          :send="state.send"
          @cancel="state.cancel"
          @resume="state.resume"
          @inspect="state.inspectArtifact"
        /><DocumentPane
          v-if="document"
          :key="document.id"
          :document="document"
          :editable="snapshot.capabilities.can_edit"
          :busy="busy"
          @propose="state.propose"
        />
      </div>
    </template>
  </main>
</template>
