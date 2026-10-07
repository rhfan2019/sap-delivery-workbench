<script setup lang="ts">
import { useRoute } from 'vue-router';
import AgentWorkbench from './AgentWorkbench.vue';
const route = useRoute();
</script>
<template>
  <AgentWorkbench
    :key="route.fullPath"
    :storage-scope="`sandbox:${route.query.project || ''}:${route.query.item || ''}`"
    :scope-selection="{
      projectId: String(route.query.project || '') || null,
      itemId: String(route.query.item || '') || null,
    }"
  />
</template>
