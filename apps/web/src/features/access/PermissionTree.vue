<script setup lang="ts">
import { computed, ref } from 'vue';
import { Search } from '@lucide/vue';
import {
  PERMISSIONS,
  PERMISSION_GROUPS,
  viewOf,
} from '@sap-delivery-workbench/contracts/access/catalog';
import BaseTag from '../../components/base/BaseTag.vue';

// The permission tree of the role editor (docs/specs/project-access-admin.md 2.2): groups (menus)
// and their permissions, each marked 菜单 / 操作 / 字段. Picking any permission of a group picks
// its view permission; dropping the view permission drops the rest of the group.
const value = defineModel<string[]>({ default: () => [] });
const props = withDefaults(
  defineProps<{ scope: 'organization' | 'project'; readonly?: boolean }>(),
  { readonly: false },
);
const query = ref('');
const onlyChosen = ref(false);
const kinds = {
  menu: ['菜单', 'blue'],
  action: ['操作', 'neutral'],
  field: ['字段', 'purple'],
} as const;
const groups = computed(() =>
  PERMISSION_GROUPS.filter((g) => props.scope === 'organization' || g.scope === 'project')
    .map((g) => ({
      ...g,
      items: PERMISSIONS.filter((p) => p.group === g.key).filter(
        (p) =>
          (!onlyChosen.value || value.value.includes(p.code)) &&
          (p.label + p.description + p.code + g.label)
            .toLowerCase()
            .includes(query.value.trim().toLowerCase()),
      ),
      all: PERMISSIONS.filter((p) => p.group === g.key).map((p) => p.code),
    }))
    .filter((g) => g.items.length),
);
function set(next: string[]) {
  value.value = PERMISSIONS.map((p) => p.code).filter((c) => next.includes(c));
}
function toggle(code: string) {
  if (props.readonly) return;
  if (value.value.includes(code)) {
    const view = viewOf(code) === code;
    const group = PERMISSIONS.find((p) => p.code === code)!.group;
    set(
      value.value.filter(
        (c) => c !== code && !(view && PERMISSIONS.find((p) => p.code === c)?.group === group),
      ),
    );
  } else set([...value.value, code, viewOf(code)!]);
}
function toggleGroup(all: string[]) {
  if (props.readonly) return;
  const every = all.every((c) => value.value.includes(c));
  set(every ? value.value.filter((c) => !all.includes(c)) : [...value.value, ...all]);
}
const state = (all: string[]) => {
  const n = all.filter((c) => value.value.includes(c)).length;
  return n === 0 ? false : n === all.length ? true : 'mixed';
};
</script>
<template>
  <div class="tree">
    <div class="tree-tools">
      <label class="s-search"
        ><Search :size="14" /><input
          v-model="query"
          placeholder="搜索权限点"
          aria-label="搜索权限点"
      /></label>
      <label class="s-check"><input v-model="onlyChosen" type="checkbox" />只看已选</label>
      <span class="tree-count">已选 {{ value.length }} 项</span>
    </div>
    <section v-for="g in groups" :key="g.key" class="tree-group">
      <header class="tree-head">
        <label class="s-check">
          <input
            type="checkbox"
            :checked="state(g.all) === true"
            :indeterminate.prop="state(g.all) === 'mixed'"
            :disabled="readonly"
            @change="toggleGroup(g.all)"
          />
          <strong>{{ g.label }}</strong>
        </label>
        <BaseTag variant="outline">{{ g.scope === 'project' ? '项目级' : '企业级' }}</BaseTag>
      </header>
      <ul>
        <li v-for="p in g.items" :key="p.code">
          <label class="tree-item" :class="{ readonly }">
            <input
              type="checkbox"
              :checked="value.includes(p.code)"
              :disabled="readonly"
              @change="toggle(p.code)"
            />
            <span class="tree-text">
              <span class="tree-name"
                >{{ p.label
                }}<BaseTag :tone="kinds[p.kind as 'menu'][1]">{{
                  kinds[p.kind as 'menu'][0]
                }}</BaseTag></span
              >
              <small
                >{{ p.description }}<code>{{ p.code }}</code></small
              >
            </span>
          </label>
        </li>
      </ul>
    </section>
    <p v-if="!groups.length" class="s-note">没有匹配的权限点。</p>
  </div>
</template>
<style scoped>
.tree {
  display: grid;
  gap: var(--space-3);
}
.tree-tools {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
}
.tree-count {
  margin-left: auto;
  color: var(--text-muted);
  font-size: var(--font-12);
}
.tree-group {
  border: 1px solid var(--border);
  border-radius: var(--radius-8);
  overflow: hidden;
}
.tree-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-2) var(--space-3);
  background: var(--neutral-bg-2);
  border-bottom: 1px solid var(--border);
}
.tree-head strong {
  font-weight: var(--weight-550);
}
ul {
  display: grid;
  margin: 0;
  padding: 0;
  list-style: none;
}
li + li {
  border-top: 1px solid var(--border);
}
.tree-item {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2-5);
  padding: var(--space-2) var(--space-3) var(--space-2) var(--space-6);
  cursor: pointer;
  transition: background var(--motion-fast);
}
.tree-item:hover:not(.readonly) {
  background: var(--hover);
}
.tree-item.readonly {
  cursor: default;
}
.tree-item input {
  width: 16px;
  height: 16px;
  margin: var(--space-0-5) 0 0;
  accent-color: var(--primary);
}
.tree-text {
  display: grid;
  gap: var(--space-0-5);
  min-width: 0;
}
.tree-name {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.tree-text small {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  color: var(--text-muted);
  font-size: var(--font-12);
}
code {
  color: var(--text-subtle);
  font-family: var(--font-mono);
  font-size: var(--font-11);
}
</style>
