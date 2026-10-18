<script setup lang="ts">
import { useRoute } from 'vue-router';
import ItemWorkspaceView from '../agent-workbench/ItemWorkspaceView.vue';
import type { StageConfig } from '../agent-workbench/stage';
import DocumentPanel from './DocumentPanel.vue';
const route = useRoute();
const config: StageConfig = {
  agent: 'abap-fsd-agent',
  assistantName: '设计助手',
  readonlyNote:
    '当前为只读：你没有在本开发项使用设计助手的权限（需要“使用设计助手”，并在你的模块范围内）。',
  sessionsHeading: '本开发项的设计对话',
  development: false,
  sapPurpose: 'test',
  artifactPanel: DocumentPanel,
  latestRevision: (detail) => detail?.document?.version,
  sessionVersion: (s) => (s.documentVersion ? ` · 文档第 ${s.documentVersion} 版` : ''),
};
</script>
<template>
  <ItemWorkspaceView
    :key="`${route.params.projectId}:${route.params.itemId}`"
    :project-id="String(route.params.projectId)"
    :item-id="String(route.params.itemId)"
    :config="config"
  />
</template>
