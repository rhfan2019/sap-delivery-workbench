<script setup lang="ts">
import AppIcon from '../../components/AppIcon.vue';
import BaseBanner from '../../components/base/BaseBanner.vue';
import BaseEmptyState from '../../components/base/BaseEmptyState.vue';
import BaseSkeleton from '../../components/base/BaseSkeleton.vue';
import { currentProject } from '../../services/projectContext';
// The states a project settings page shares: no project chosen, loading, failed, archived.
defineProps<{ loading: boolean; error: string; ready: boolean; archived?: boolean }>();
</script>
<template>
  <BaseEmptyState
    v-if="!currentProject"
    title="还没有选择项目"
    text="在左上角的项目切换器中选择一个项目，这里会显示它的设置。"
  >
    <template #icon><AppIcon name="folder" :size="16" /></template>
  </BaseEmptyState>
  <p v-else-if="error" class="s-error" role="alert">{{ error }}</p>
  <div v-else-if="loading && !ready" class="gate-skeleton">
    <BaseSkeleton height="120px" />
    <BaseSkeleton height="200px" />
  </div>
  <template v-else-if="ready">
    <BaseBanner v-if="archived" tone="yellow">项目已归档，所有信息只能查看。</BaseBanner>
    <slot />
  </template>
</template>
<style scoped>
.gate-skeleton {
  display: grid;
  gap: var(--space-3);
}
</style>
