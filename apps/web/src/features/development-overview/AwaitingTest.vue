<script setup lang="ts">
import BaseAvatar from '../../components/base/BaseAvatar.vue';
import type { Overview } from './model';

// Developed items waiting for the consultant test, longest wait first (M15). Shared by the
// development-team and tester views.
defineProps<{ rows: Overview['development']['awaitingTest'] }>();
defineEmits<{ open: [id: string] }>();
</script>
<template>
  <div class="ov-card">
    <p v-if="!rows.length" class="ov-empty">没有等待顾问测试的开发项。</p>
    <table v-else class="ov-table">
      <thead>
        <tr>
          <th>编号</th>
          <th>开发名称</th>
          <th>顾问测试人</th>
          <th class="num">已等待</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="a in rows" :key="a.id" class="link" @click="$emit('open', a.id)">
          <td class="code">{{ a.code }}</td>
          <td class="main">{{ a.name }}</td>
          <td>
            <span v-if="a.tester" class="ov-person"
              ><BaseAvatar :name="a.tester" :size="20" />{{ a.tester }}</span
            >
            <span v-else class="ov-muted">未分配</span>
          </td>
          <td class="num">{{ a.waitDays === null ? '—' : a.waitDays + ' 天' }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
