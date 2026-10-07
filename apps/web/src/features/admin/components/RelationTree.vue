<script setup lang="ts">
import { ref } from 'vue';
import AppIcon from '../../../components/AppIcon.vue';
import type { Customer, AdminProject } from '../types';
defineProps<{
  organizationName: string;
  customers: Customer[];
  projects: AdminProject[];
  selectedCustomer?: string;
  selectedProject?: string;
  mode?: 'customer' | 'project';
}>();
const emit = defineEmits<{ customer: [id: string]; project: [id: string] }>();
const closed = ref<string[]>([]);
function toggle(id: string) {
  closed.value = closed.value.includes(id)
    ? closed.value.filter((x) => x !== id)
    : [...closed.value, id];
}
</script>
<template>
  <aside class="relation-tree" aria-label="企业客户项目导航">
    <div class="tree-heading">
      <h2>{{ mode === 'project' ? '项目范围' : '业务关系' }}</h2>
      <AppIcon name="layers" :size="16" />
    </div>
    <div class="tree-root">
      <AppIcon name="building" :size="16" /><strong>{{ organizationName }}</strong>
    </div>
    <button
      v-if="mode !== 'project'"
      class="tree-node tree-all"
      :class="{ selected: !selectedCustomer && !selectedProject }"
      @click="emit('customer', '')"
    >
      <AppIcon name="folder" :size="15" />全部客户<span class="count-badge">{{
        customers.length
      }}</span>
    </button>
    <div class="tree-branches">
      <div v-for="customer in customers" :key="customer.id" class="tree-branch">
        <div class="tree-customer-line">
          <button
            class="tree-toggle"
            :aria-label="(closed.includes(customer.id) ? '展开' : '收起') + customer.name"
            :aria-expanded="!closed.includes(customer.id)"
            @click="toggle(customer.id)"
          >
            <AppIcon
              name="chevron"
              :size="12"
              :class="{ folded: closed.includes(customer.id) }"
            /></button
          ><button
            class="tree-node"
            :class="{ selected: selectedCustomer === customer.id && !selectedProject }"
            @click="emit('customer', customer.id)"
          >
            <AppIcon name="building" :size="14" /><span>{{ customer.name }}</span>
          </button>
        </div>
        <div v-if="!closed.includes(customer.id)" class="tree-projects">
          <button
            v-for="project in projects.filter((p) => p.customerId === customer.id)"
            :key="project.id"
            class="tree-node"
            :class="{ selected: selectedProject === project.id }"
            @click="emit('project', project.id)"
          >
            <AppIcon name="folder" :size="12" /><span>{{ project.name }}</span>
          </button>
          <p v-if="!projects.some((p) => p.customerId === customer.id)" class="tree-empty">
            暂无项目
          </p>
        </div>
      </div>
    </div>
    <p v-if="!customers.length" class="tree-empty">创建客户后，关系将在这里呈现。</p>
  </aside>
</template>

<style scoped>
.tree-customer-line .count-badge {
  margin-left: auto;
  flex-shrink: 0;
}
.tree-customer-line .tree-node {
  flex: 1;
}
.tree-customer-line .tree-node > svg {
  flex-shrink: 0;
}
</style>
