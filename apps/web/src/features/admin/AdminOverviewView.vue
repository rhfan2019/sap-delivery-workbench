<script setup lang="ts">
import { computed } from 'vue';
import AppIcon from '../../components/AppIcon.vue';
import BaseTag from '../../components/base/BaseTag.vue';
import { modules } from '../navigation';

// The settings overview (DESIGN.md 6.2): one centred column, a group per menu section, and two
// columns of cards (icon tile, title, one sentence) that open each settings page.
const notes: Record<string, string> = {
  组织: '企业资料、客户与项目，以及谁能进入哪个项目。',
  系统与模型: '连接 SAP 后端系统与大模型，验证它们可用。',
  运行与审计: '提示词与流程、助手运行任务，以及审计记录。',
};
// Pages that are planned but not open yet.
const planned = new Set(['permissions', 'workflows', 'tasks']);
const sections = computed(
  () =>
    modules
      .find((m) => m.id === 'admin')
      ?.sections.filter((s) => s.label)
      .map((s) => ({ ...s, note: notes[s.label!] ?? '' })) ?? [],
);
</script>
<template>
  <div class="admin-overview">
    <header class="page-heading">
      <div>
        <h1>后台管理</h1>
        <p class="muted">企业管理员在这里维护组织、系统与模型，并查看运行与审计。</p>
      </div>
    </header>
    <section v-for="s in sections" :key="s.label" class="overview-group">
      <h2>{{ s.label }}</h2>
      <p class="overview-note">{{ s.note }}</p>
      <div class="overview-cards">
        <RouterLink v-for="i in s.items" :key="i.id" :to="i.path" class="overview-card">
          <span class="overview-tile"><AppIcon :name="i.icon" :size="16" /></span>
          <span class="overview-text">
            <strong>{{ i.label }}<BaseTag v-if="planned.has(i.id)">规划中</BaseTag></strong>
            <small>{{ i.description }}</small>
          </span>
        </RouterLink>
      </div>
    </section>
  </div>
</template>
<style scoped>
.admin-overview {
  max-width: 720px;
  margin: 0 auto;
  padding: var(--space-4) 0 var(--space-12);
}
.overview-group {
  padding: var(--space-6) 0;
  border-top: 1px solid var(--border);
}
.overview-group h2 {
  font-size: var(--font-16);
  line-height: var(--leading-24);
  font-weight: var(--weight-550);
}
.overview-note {
  margin-top: var(--space-1);
  font-size: var(--font-14);
  color: var(--text-muted);
}
.overview-cards {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-3);
  margin-top: var(--space-4);
}
.overview-card {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  padding: var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-8);
  background: var(--panel);
  box-shadow: var(--shadow-card);
  transition:
    background var(--motion-fast),
    border-color var(--motion-fast);
}
.overview-card:hover {
  background: var(--neutral-bg-2);
  border-color: var(--border-strong);
}
.overview-tile {
  display: grid;
  place-items: center;
  width: var(--control-icon);
  height: var(--control-icon);
  flex-shrink: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius-6);
  color: var(--neutral-icon-1);
  background: var(--panel);
}
.overview-text {
  display: grid;
  gap: var(--space-0-5);
  min-width: 0;
}
.overview-text strong {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--font-14);
  font-weight: var(--weight-550);
}
.overview-text small {
  font-size: var(--font-12);
  line-height: var(--leading-16);
  color: var(--text-muted);
}
@media (max-width: 760px) {
  .overview-cards {
    grid-template-columns: 1fr;
  }
}
</style>
