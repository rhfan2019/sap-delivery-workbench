<script setup lang="ts">
import { useRoute } from 'vue-router';
import ItemWorkspaceView from '../agent-workbench/ItemWorkspaceView.vue';
import type { StageConfig } from '../agent-workbench/stage';
import DevArtifactPanel from './DevArtifactPanel.vue';
const route = useRoute();
const config: StageConfig = {
  agent: 'abap-dev-agent',
  stageLabel: '开发',
  assistantName: '开发助手',
  readonlyNote: '当前为只读，仅开发负责人或项目管理员可以修改。',
  sessionsHeading: '本开发项的开发对话',
  development: true,
  sapEnvironment: 'DEV',
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
