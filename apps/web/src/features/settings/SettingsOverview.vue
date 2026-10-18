<script setup lang="ts">
import { computed } from 'vue';
import AppIcon from '../../components/AppIcon.vue';
import BaseTag from '../../components/base/BaseTag.vue';
import { settingsSections, visibleSections } from '../navigation';
import { identity } from '../../services/session';
import { currentProject, projectAccess, projects } from '../../services/projectContext';
import SettingsPage from './SettingsPage.vue';

// The settings overview (Plain's /settings): one group per menu section, two columns of cards.
const project = computed(() => projects.value.find((p) => p.id === currentProject.value));
const sections = computed(() =>
  visibleSections(settingsSections, {
    organization: identity.value?.permissions ?? [],
    project: projectAccess.value,
  }).map((s) =>
    s.id === 'project'
      ? { ...s, label: '项目 · ' + (project.value?.shortName || project.value?.name || '') }
      : s,
  ),
);
</script>
<template>
  <SettingsPage title="设置" description="个人、当前项目与企业的全部设置。">
    <section v-for="s in sections" :key="s.id" class="overview-group">
      <h2>{{ s.label }}</h2>
      <p class="overview-note">{{ s.note }}</p>
      <div class="overview-cards">
        <RouterLink v-for="i in s.items" :key="i.id" :to="i.path" class="overview-card">
          <span class="overview-tile"><AppIcon :name="i.icon" :size="16" /></span>
          <span class="overview-text">
            <strong>{{ i.label }}<BaseTag v-if="i.planned">规划中</BaseTag></strong>
            <small>{{ i.description }}</small>
          </span>
        </RouterLink>
      </div>
    </section>
    <p v-if="!currentProject" class="overview-hint">
      在左上角选择一个项目后，这里会出现该项目的设置。
    </p>
  </SettingsPage>
</template>
<style scoped>
.overview-group {
  padding: var(--space-6) 0 var(--space-2);
  border-top: 1px solid var(--border);
}
.overview-group h2 {
  margin: 0;
  font-size: var(--font-16);
  line-height: var(--leading-24);
  font-weight: var(--weight-550);
}
.overview-note {
  margin: var(--space-1) 0 0;
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
  color: inherit;
  text-decoration: none;
  transition:
    background var(--motion-fast),
    border-color var(--motion-fast);
}
.overview-card:hover {
  background: var(--neutral-bg-2);
  border-color: var(--border-strong);
}
.overview-card:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--focus);
}
.overview-tile {
  display: grid;
  place-items: center;
  width: var(--control-icon);
  height: var(--control-icon);
  flex-shrink: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius-6);
  color: var(--blue-icon-1);
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
  font-weight: var(--weight-550);
}
.overview-text small {
  color: var(--text-muted);
  font-size: var(--font-12);
  line-height: var(--leading-16);
}
.overview-hint {
  color: var(--text-muted);
  font-size: var(--font-12);
}
@media (max-width: 760px) {
  .overview-cards {
    grid-template-columns: 1fr;
  }
}
</style>
