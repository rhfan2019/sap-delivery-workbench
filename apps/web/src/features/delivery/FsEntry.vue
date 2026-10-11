<script setup lang="ts">
import { ref, computed } from 'vue';
import FsEditor from './FsEditor.vue';
import type { Item } from './model';
defineProps<{ path: string; item: Item; writable: boolean }>();
const emit = defineEmits<{ updated: [] }>();
const editor = ref<InstanceType<typeof FsEditor> | null>(null);
defineExpose({
  dirty: computed(() => editor.value?.dirty ?? false),
  busy: computed(() => editor.value?.busy ?? false),
});
</script>
<template>
  <section>
    <div class="delivery-empty">
      <h3>FSD 设计助手</h3>
      <p>在对话中澄清需求、查询 SAP，并编写和修订 FSD。</p>
      <RouterLink :to="path + '/design'">进入设计助手</RouterLink>
    </div>
    <FsEditor
      ref="editor"
      :path="path"
      :item="item"
      :writable="writable"
      @updated="emit('updated')"
    />
  </section>
</template>
