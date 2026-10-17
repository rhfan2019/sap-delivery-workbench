<script setup lang="ts">
import { Check } from '@lucide/vue';
import { THEMES, setTheme, theme } from '../services/theme';
</script>
<template>
  <section class="theme-settings" aria-labelledby="theme-settings-title">
    <h2 id="theme-settings-title">主题</h2>
    <p class="theme-settings-note">选择后立即应用到整个网站，并记在这台电脑的浏览器中。</p>
    <div class="theme-grid" role="radiogroup" aria-label="网站主题">
      <button
        v-for="t in THEMES"
        :key="t.id"
        type="button"
        role="radio"
        class="theme-card"
        :aria-checked="theme === t.id"
        @click="setTheme(t.id)"
      >
        <!-- The preview carries its own theme, so each card shows its colours and corners. -->
        <span class="theme-preview" :data-ui-theme="t.id" aria-hidden="true">
          <span class="preview-nav">
            <span class="preview-dot" />
            <span class="preview-line short" />
            <span class="preview-line active" />
            <span class="preview-line" />
          </span>
          <span class="preview-main">
            <span class="preview-title" />
            <span class="preview-card">
              <span class="preview-line" />
              <span class="preview-line short" />
              <span class="preview-button" />
            </span>
          </span>
        </span>
        <span class="theme-text">
          <strong
            >{{ t.name }}<Check v-if="theme === t.id" :size="16" aria-label="当前主题"
          /></strong>
          <small>{{ t.note }}</small>
        </span>
      </button>
    </div>
  </section>
</template>
<style scoped>
.theme-settings h2 {
  margin: 0;
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-semibold);
}
.theme-settings-note {
  margin: var(--space-1) 0 var(--space-4);
  font-size: var(--font-size-sm);
  color: var(--muted);
}
.theme-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: var(--space-4);
  max-width: 1000px;
}
.theme-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface);
  color: var(--text);
  text-align: left;
  cursor: pointer;
}
.theme-card:hover {
  border-color: var(--border-strong);
}
.theme-card[aria-checked='true'] {
  border-color: var(--primary);
  box-shadow: 0 0 0 1px var(--primary);
}
.theme-text strong {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-semibold);
}
.theme-text strong svg {
  color: var(--primary);
}
.theme-text small {
  display: block;
  margin-top: var(--space-1);
  font-size: var(--font-size-xs);
  line-height: 1.6;
  color: var(--muted);
}
/* A small page in the card's own theme: sidebar, title, a card with a primary button. */
.theme-preview {
  display: flex;
  height: 112px;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg);
}
.preview-nav {
  display: flex;
  flex-direction: column;
  gap: var(--space-1-5);
  width: 34%;
  padding: var(--space-2);
  background: var(--nav-bg);
  border-right: 1px solid var(--nav-border);
}
.preview-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-2-5);
}
.preview-dot {
  width: 14px;
  height: 14px;
  border-radius: var(--radius-sm);
  background: var(--primary);
}
.preview-line {
  display: block;
  height: 6px;
  border-radius: var(--radius-full);
  background: var(--border-strong);
}
.preview-line.short {
  width: 60%;
}
.preview-line.active {
  background: var(--nav-active);
  box-shadow: inset 3px 0 0 var(--primary);
  height: 10px;
}
.preview-title {
  display: block;
  width: 55%;
  height: 9px;
  border-radius: var(--radius-full);
  background: var(--text);
}
.preview-card {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--space-1-5);
  padding: var(--space-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface);
}
.preview-button {
  margin-top: auto;
  align-self: flex-end;
  width: 42px;
  height: 14px;
  border-radius: var(--radius-md);
  background: var(--primary);
}
</style>
