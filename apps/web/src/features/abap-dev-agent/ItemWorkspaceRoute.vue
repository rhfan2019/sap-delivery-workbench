<script setup lang="ts">
import { useRoute } from 'vue-router';
import ItemWorkspaceView from '../agent-workbench/ItemWorkspaceView.vue';
import type { StageConfig } from '../agent-workbench/stage';
import DevArtifactPanel from './DevArtifactPanel.vue';
const route = useRoute();
const config: StageConfig = {
  agent: 'abap-dev-agent',
  assistantName: '开发助手',
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
