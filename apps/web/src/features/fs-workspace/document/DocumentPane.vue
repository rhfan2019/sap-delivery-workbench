<script setup lang="ts">
import type { FsDocument } from '../api';
import { ref } from 'vue';
defineProps<{ document: FsDocument; editable?: boolean; busy?: boolean }>();
defineEmits<{ propose: [block: FsDocument['sections'][number]['blocks'][number], text: string] }>();
const editing = ref(''),
  text = ref('');
</script>
<template>
  <section aria-label="固定版本文档" class="fs-document">
    <header>
      <h2>{{ document.title }}</h2>
      <p>
        草稿修订 {{ document.revision }} ·
        {{ document.version_number ? `保存版本 V${document.version_number}` : '讨论稿' }}
      </p>
      <p class="fs-muted">内容尚不代表批准或发布的开发依据。</p>
    </header>
    <nav aria-label="文档章节">
      <a
        v-for="section in document.sections"
        :key="section.id"
        :href="'#fs-section-' + section.id"
        >{{ section.title }}</a
      >
    </nav>
    <article
      v-for="section in document.sections"
      :id="'fs-section-' + section.id"
      :key="section.id"
    >
      <h3>{{ section.title }}</h3>
      <div v-for="block in section.blocks" :key="block.id" class="fs-block">
        <p v-if="block.classification === 'pending'" class="fs-muted">待确认</p>
        <div v-if="block.kind === 'table'" class="fs-table">
          <table>
            <thead>
              <tr>
                <th v-for="(column, i) in block.columns" :key="i">{{ column }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in block.rows" :key="row.id">
                <td v-for="(cell, i) in row.cells" :key="i">{{ cell }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-else>{{ block.text }}</p>
        <template v-if="editable && block.kind !== 'table'"
          ><button
            v-if="editing !== block.id"
            :disabled="busy"
            @click="
              editing = block.id;
              text = block.text ?? '';
            "
          >
            修改此段
          </button>
          <form v-else @submit.prevent="$emit('propose', block, text)">
            <label :for="'edit-' + block.id">修订内容</label
            ><textarea :id="'edit-' + block.id" v-model="text" rows="5" :disabled="busy" /><button
              :disabled="busy"
            >
              生成修改候选</button
            ><button type="button" :disabled="busy" @click="editing = ''">关闭编辑</button>
          </form></template
        >
        <ul v-if="block.evidence_refs.length">
          <li v-for="reference in block.evidence_refs" :key="reference.evidence_id">
            来源 {{ reference.locator }}：{{ reference.conclusion }}
          </li>
        </ul>
      </div>
    </article>
  </section>
</template>
