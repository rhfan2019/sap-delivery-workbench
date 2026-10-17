<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { Check, FileText, Search, ArrowUp } from '@lucide/vue';
import {
  MODES,
  THEMES,
  loadThemeFont,
  mode,
  resolvedMode,
  setAppearance,
  theme,
  type ModeId,
  type ThemeId,
} from '../services/theme';

// 个人设置 › 外观 (contract 1.14, DESIGN.md 11): pick a theme and a mode; the choice is kept
// with the account. Below, the shared components as the pages use them, in the current theme.
const error = ref(''),
  tab = ref('list');
onMounted(() => THEMES.forEach((t) => loadThemeFont(t.id)));
async function choose(next: { theme?: ThemeId; mode?: ModeId }) {
  error.value = '';
  try {
    await setAppearance(next);
  } catch (e) {
    error.value = '已在本机应用，但没能保存到账号：' + (e as Error).message;
  }
}
</script>
<template>
  <section class="theme-settings" aria-labelledby="theme-settings-title">
    <h2 id="theme-settings-title">主题</h2>
    <p class="theme-settings-note">选择后立即应用到整个网站，并保存在你的账号中。</p>
    <div class="theme-grid" role="radiogroup" aria-label="网站主题">
      <button
        v-for="t in THEMES"
        :key="t.id"
        type="button"
        role="radio"
        class="theme-option"
        :aria-checked="theme === t.id"
        @click="choose({ theme: t.id })"
      >
        <!-- The preview carries its own theme in the current mode: colours, type and shapes. -->
        <span
          class="theme-preview"
          :data-ui-theme="t.id"
          :data-ui-mode="resolvedMode"
          aria-hidden="true"
        >
          <span class="preview-nav">
            <span class="preview-dot" />
            <span class="preview-line short" />
            <span class="preview-item" />
            <span class="preview-line" />
          </span>
          <span class="preview-main">
            <span class="preview-title">开发清单</span>
            <span class="preview-card">
              <span class="preview-line" />
              <span class="preview-line short" />
              <span class="preview-actions">
                <span class="preview-badge">进行中</span>
                <span class="preview-button">新建</span>
              </span>
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

    <h2 class="theme-subtitle">显示模式</h2>
    <div class="mode-switch" role="radiogroup" aria-label="显示模式">
      <button
        v-for="m in MODES"
        :key="m.id"
        type="button"
        role="radio"
        :aria-checked="mode === m.id"
        @click="choose({ mode: m.id })"
      >
        {{ m.name }}
      </button>
    </div>
    <p v-if="error" class="error-note" role="alert">{{ error }}</p>

    <h2 class="theme-subtitle">组件预览</h2>
    <p class="theme-settings-note">网站各页面使用的公共组件在当前主题下的样子。</p>
    <div class="gallery">
      <div class="surface gallery-block">
        <h3>按钮与输入</h3>
        <div class="gallery-row">
          <button type="button" class="primary-button">保存</button>
          <button type="button" class="secondary-button">取消</button>
          <button type="button" class="text-button">查看全部</button>
        </div>
        <div class="gallery-row">
          <label class="filter-input"
            ><Search :size="16" /><input placeholder="搜索开发项"
          /></label>
          <select class="gallery-select" aria-label="模块">
            <option>全部模块</option>
            <option>SD</option>
          </select>
        </div>
      </div>
      <div class="surface gallery-block">
        <h3>页签与标签</h3>
        <nav class="tabs admin-tabs gallery-tabs" aria-label="示例页签">
          <button
            v-for="t in [
              ['list', '全部'],
              ['mine', '我的 FSD'],
              ['late', '计划逾期'],
            ]"
            :key="t[0]"
            type="button"
            :class="{ active: tab === t[0] }"
            @click="tab = t[0]"
          >
            {{ t[1] }}
          </button>
        </nav>
        <div class="gallery-row">
          <span class="admin-badge">进行中</span>
          <span class="admin-badge muted">未开始</span>
          <span class="tag-sample" data-color="blue">SD</span>
          <span class="tag-sample" data-color="green">已完成</span>
          <span class="tag-sample" data-color="orange">待确认</span>
        </div>
        <p class="success-note">已保存新版本。</p>
        <p class="error-note">SAP 连接超时，请稍后重试。</p>
      </div>
      <div class="surface gallery-block gallery-wide">
        <h3>表格</h3>
        <div class="admin-table-wrap">
          <table class="admin-table">
            <thead>
              <tr>
                <th>编号</th>
                <th>开发名称</th>
                <th>模块</th>
                <th>FSD 状态</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>00028</td>
                <td><strong>账龄分析表</strong></td>
                <td>FICO</td>
                <td><span class="admin-badge">已完成</span></td>
              </tr>
              <tr>
                <td>00025</td>
                <td><strong>交货到期清单与逾期分析</strong></td>
                <td>SD</td>
                <td><span class="admin-badge muted">未开始</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <div class="surface gallery-block gallery-wide">
        <h3>智能助手对话</h3>
        <div class="chat-sample">
          <p class="chat-bubble">帮我拉个销售订单清单，按销售组织和创建日期查。</p>
          <p class="chat-reply">
            初稿已写好：按销售组织取订单抬头与行项目，本币金额按订单创建日的汇率折算。
          </p>
          <span class="chat-artifact"
            ><FileText :size="18" /><span
              ><strong>功能说明书</strong><small>第 1 版 · 已保存</small></span
            ><em>打开</em></span
          >
          <span class="chat-composer"
            >描述需求，或继续追问…<span class="chat-send"><ArrowUp :size="16" /></span
          ></span>
        </div>
      </div>
    </div>
  </section>
</template>
<style scoped>
.theme-settings h2 {
  margin: 0;
  font-size: var(--font-size-xl);
}
.theme-subtitle {
  margin-top: var(--space-8) !important;
}
.theme-settings-note {
  margin: var(--space-1) 0 var(--space-4);
  font-size: var(--font-size-sm);
  color: var(--muted);
}
.theme-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: var(--space-4);
  max-width: 1000px;
}
.theme-option {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--card-radius);
  background: var(--surface);
  color: var(--text);
  text-align: left;
  cursor: pointer;
}
.theme-option:hover {
  border-color: var(--border-strong);
}
.theme-option[aria-checked='true'] {
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
  color: var(--link);
}
.theme-text small {
  display: block;
  margin-top: var(--space-1);
  font-size: var(--font-size-xs);
  line-height: 1.6;
  color: var(--muted);
}
/* A small page in the card's own theme: its sidebar, title type, card, badge and button. */
.theme-preview {
  display: flex;
  height: 132px;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--page-bg);
  color: var(--text);
  font-family: var(--font-sans);
}
.preview-nav {
  display: flex;
  flex-direction: column;
  gap: var(--space-1-5);
  width: 30%;
  padding: var(--space-2);
  background: var(--sidebar-bg);
  border-right: 1px solid var(--sidebar-border);
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
.preview-item {
  height: 12px;
  border-radius: var(--nav-item-radius);
  background: var(--nav-item-active-bg);
}
.preview-title {
  font-family: var(--font-display);
  font-weight: var(--heading-weight);
  letter-spacing: var(--heading-letter-spacing);
  font-size: var(--font-size-md);
}
.preview-card {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--space-1-5);
  padding: var(--space-2);
  border: var(--card-border-width) solid var(--card-border);
  border-radius: var(--card-radius);
  background: var(--card-bg);
  box-shadow: var(--card-shadow);
}
.preview-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: auto;
}
.preview-badge {
  padding: 0 var(--space-1-5);
  border-radius: var(--badge-radius);
  background: var(--active);
  color: var(--link);
  font-size: var(--font-size-xs);
  font-weight: var(--badge-font-weight);
}
.preview-button {
  padding: var(--space-0-5) var(--space-2-5);
  border-radius: var(--button-radius);
  background: var(--button-primary-bg);
  color: var(--button-primary-text);
  font-size: var(--font-size-xs);
  font-weight: var(--button-font-weight);
}
.mode-switch {
  display: inline-flex;
  gap: var(--space-1);
  margin-top: var(--space-3);
  padding: var(--space-1);
  border: 1px solid var(--border);
  border-radius: var(--button-radius);
  background: var(--surface-muted);
}
.mode-switch button {
  min-height: 32px;
  padding: 0 var(--space-4);
  border-radius: var(--button-radius);
  color: var(--muted);
  font-size: var(--font-size-sm);
}
.mode-switch button[aria-checked='true'] {
  background: var(--surface);
  color: var(--text);
  font-weight: var(--font-weight-medium);
  box-shadow: var(--shadow-raised);
}
.gallery {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-4);
  max-width: 1000px;
}
.gallery-wide {
  grid-column: 1 / -1;
}
.gallery-block {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.gallery-block h3 {
  font-size: var(--font-size-md);
}
.gallery-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}
.gallery-row .filter-input input {
  height: calc(var(--input-height) - 2px);
}
.gallery-select {
  height: var(--input-height);
  padding: 0 var(--space-3);
  border: var(--input-border-width) solid var(--input-border);
  border-radius: var(--input-radius);
  background: var(--input-bg);
  color: var(--input-text);
}
.gallery-tabs {
  margin-bottom: 0 !important;
}
.tag-sample {
  padding: var(--space-0-5) var(--space-2);
  border-radius: var(--badge-radius);
  font-size: var(--font-size-xs);
  font-weight: var(--badge-font-weight);
}
.tag-sample[data-color='blue'] {
  background: var(--tag-blue-bg);
  color: var(--tag-blue-text);
}
.tag-sample[data-color='green'] {
  background: var(--tag-green-bg);
  color: var(--tag-green-text);
}
.tag-sample[data-color='orange'] {
  background: var(--tag-orange-bg);
  color: var(--tag-orange-text);
}
.chat-sample {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  max-width: 640px;
}
.chat-bubble {
  align-self: flex-end;
  max-width: 80%;
  padding: var(--space-2-5) var(--space-4);
  border-radius: var(--bubble-radius);
  background: var(--bubble-bg);
  color: var(--bubble-text);
}
.chat-reply {
  font-size: var(--font-size-lg);
  line-height: 1.7;
}
.chat-artifact {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: min(100%, 360px);
  padding: var(--space-2-5) var(--space-3);
  border: 1px solid var(--card-border);
  border-radius: var(--card-radius);
  background: var(--card-bg);
}
.chat-artifact > svg {
  color: var(--link);
}
.chat-artifact span {
  flex: 1;
  display: flex;
  flex-direction: column;
}
.chat-artifact small {
  color: var(--muted);
  font-size: var(--font-size-xs);
}
.chat-artifact em {
  font-style: normal;
  color: var(--link);
  font-weight: var(--font-weight-medium);
}
.chat-composer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 56px;
  padding: var(--space-2) var(--space-2) var(--space-2) var(--space-4);
  border: 1px solid var(--composer-border);
  border-radius: var(--composer-radius);
  background: var(--input-bg);
  box-shadow: var(--composer-shadow);
  color: var(--text-tertiary);
}
.chat-send {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-full);
  background: var(--button-primary-bg);
  color: var(--button-primary-text);
}
@media (max-width: 800px) {
  .gallery {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
