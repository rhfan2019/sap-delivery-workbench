<script setup lang="ts">
import { useRoute } from 'vue-router';
import ItemWorkspaceView from './ItemWorkspaceView.vue';
const route = useRoute();
</script>
<template>
  <ItemWorkspaceView
    :key="`${route.params.projectId}:${route.params.itemId}:${route.params.stage}`"
    :project-id="String(route.params.projectId)"
    :item-id="String(route.params.itemId)"
    :stage="String(route.params.stage)"
  />
</template>
