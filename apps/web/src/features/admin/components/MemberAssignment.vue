<script setup lang="ts">
import { computed, ref } from 'vue';
import AppIcon from '../../../components/AppIcon.vue';
import type { AdminUser, ProjectMember } from '../types';
const props = defineProps<{
  users: AdminUser[];
  members: ProjectMember[];
  busy: boolean;
  error: string;
}>();
const emit = defineEmits<{ close: []; add: [id: string] }>();
const search = ref(''),
  selected = ref('');
const choices = computed(() =>
  props.users.filter(
    (u) =>
      !props.members.some((m) => m.id === u.id) &&
      (u.displayName + u.loginName).toLowerCase().includes(search.value.toLowerCase()),
  ),
);
const eligible = (u: AdminUser) => u.status === 'active' && u.memberStatus === 'active';
</script>
<template>
  <section class="member-assignment" aria-labelledby="assignment-title">
    <header>
      <h2 id="assignment-title">添加项目成员</h2>
      <button class="icon-button" aria-label="关闭添加成员" :disabled="busy" @click="emit('close')">
        <AppIcon name="x" :size="17" />
      </button>
    </header>
    <p class="assignment-label">选择企业成员</p>
    <div class="filter-input">
      <AppIcon name="search" :size="15" /><input
        v-model="search"
        aria-label="搜索可添加成员"
        placeholder="搜索姓名或账号…"
      />
    </div>
    <form @submit.prevent="selected && emit('add', selected)">
      <div class="assignment-list">
        <label
          v-for="u in choices"
          :key="u.id"
          class="assignment-user"
          :class="{ unavailable: !eligible(u), selected: selected === u.id }"
          ><input
            v-model="selected"
            type="radio"
            name="project-member"
            :value="u.id"
            :disabled="!eligible(u) || busy"
            required
          /><span class="avatar">{{ u.displayName.slice(0, 1) }}</span
          ><span
            ><strong>{{ u.displayName }}</strong
            ><small>{{ u.loginName }}</small
            ><small>{{
              eligible(u)
                ? '账号与成员均正常'
                : u.status !== 'active'
                  ? '账号已停用'
                  : '企业成员已停用'
            }}</small></span
          ></label
        >
        <p v-if="!choices.length" class="table-empty">
          {{ search ? '未找到匹配成员' : '所有可见用户均已加入项目。可在用户账号页新建用户。' }}
        </p>
      </div>
      <p class="help-note"><AppIcon name="shield" :size="14" />仅可添加当前企业的有效成员。</p>
      <p v-if="error" class="error-note" role="alert">{{ error }}</p>
      <button class="primary-button" :disabled="!selected || busy">
        {{ busy ? '正在添加…' : '确认添加' }}
      </button>
    </form>
  </section>
</template>
