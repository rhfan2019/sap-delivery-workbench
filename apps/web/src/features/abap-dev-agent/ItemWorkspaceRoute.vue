<script setup lang="ts">
import { useRoute } from 'vue-router';
import ItemWorkspaceView from '../agent-workbench/ItemWorkspaceView.vue';
import type { StageConfig } from '../agent-workbench/stage';
import DevArtifactPanel from './DevArtifactPanel.vue';
const route = useRoute();
const config: StageConfig = {
  agent: 'abap-dev-agent',
  assistantName: '开发助手',
  readonlyNote:
    '当前为只读：你没有在本开发项使用开发助手的权限（需要“使用开发助手”，并在你的模块范围内）。',
  sessionsHeading: '本开发项的开发对话',
  development: true,
  sapPurpose: 'development',
  artifactPanel: DevArtifactPanel,
  latestRevision: (detail) => detail?.version?.version,
  sessionVersion: (s) => (s.version ? ` · 第 ${s.version} 版` : ''),
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
