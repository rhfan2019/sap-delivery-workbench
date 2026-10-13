<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { X, FileSpreadsheet, Download } from '@lucide/vue';
import { api } from '../../services/session';

// Excel import in three steps: choose a file, review the server's check, confirm.
const props = defineProps<{ base: string }>();
const emit = defineEmits<{ close: []; imported: [summary: string] }>();
interface Preview {
  rows: {
    rowNumber: number;
    code: string | null;
    action: string;
    name: string;
    fields: number;
    errors: string[];
  }[];
  recognized: string[];
  ignored: string[];
  newTags: string[];
}
const dialog = ref<HTMLDialogElement>();
const fileName = ref('');
const content = ref('');
const preview = ref<Preview | null>(null);
const busy = ref(false);
const error = ref('');
const failed = computed(() => preview.value?.rows.filter((r) => r.errors.length) ?? []);
const creates = computed(
  () => preview.value?.rows.filter((r) => r.action === 'create').length ?? 0,
);
const updates = computed(
  () => preview.value?.rows.filter((r) => r.action === 'update').length ?? 0,
);
async function choose(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  error.value = '';
  preview.value = null;
  if (!/\.xlsx$/i.test(file.name)) return void (error.value = '请选择 .xlsx 格式的 Excel 文件。');
  if (file.size > 5242880) return void (error.value = '文件不能超过 5 MB。');
  busy.value = true;
  try {
    content.value = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1]!);
      r.onerror = () => reject(new Error('文件读取失败'));
      r.readAsDataURL(file);
    });
    fileName.value = file.name;
    preview.value = await api<Preview>(props.base + '/import/preview', { content: content.value });
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
async function confirm() {
  busy.value = true;
  error.value = '';
  try {
    const r = await api<{ created: number; updated: number; newTags: number }>(
      props.base + '/import',
      {
        content: content.value,
      },
    );
    emit(
      'imported',
      `已导入：新建 ${r.created} 项，更新 ${r.updated} 项${r.newTags ? `，新建标签 ${r.newTags} 个` : ''}`,
    );
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
onMounted(() => dialog.value?.showModal());
</script>

<template>
  <dialog
    ref="dialog"
    class="import-dialog"
    aria-labelledby="import-title"
    @cancel.prevent="emit('close')"
  >
    <header>
      <div>
        <h2 id="import-title">从 Excel 导入</h2>
        <p>
          编号留空的行新建开发项，填写已有编号的行更新该开发项。导入前会先检查，全部通过才写入。
        </p>
      </div>
      <button
        type="button"
        class="icon-button"
        aria-label="关闭导入"
        :disabled="busy"
        @click="emit('close')"
      >
        <X :size="20" />
      </button>
    </header>
    <div class="import-body">
      <div class="import-pick">
        <label class="secondary-button"
          ><FileSpreadsheet :size="16" />{{ fileName ? '重新选择文件' : '选择 Excel 文件'
          }}<input type="file" accept=".xlsx" class="sr-only" :disabled="busy" @change="choose"
        /></label>
        <span v-if="fileName" class="file-name">{{ fileName }}</span>
        <a class="text-button" :href="'/api' + base + '/import-template'" download
          ><Download :size="14" />下载导入模板</a
        >
      </div>
      <p v-if="error" class="error-note" role="alert">{{ error }}</p>
      <p v-if="busy && !preview" class="help-note" role="status">正在检查文件…</p>
      <template v-if="preview">
        <p class="import-summary" :class="{ bad: failed.length }" role="status">
          共 {{ preview.rows.length }} 行：新建 {{ creates }} 项，更新 {{ updates }} 项<template
            v-if="preview.newTags.length"
            >，将新建标签 {{ preview.newTags.join('、') }}</template
          ><template v-if="failed.length"
            >；<strong>{{ failed.length }} 行有错误，请修正后重新选择文件</strong></template
          >
        </p>
        <p v-if="preview.ignored.length" class="help-note">
          以下列未识别，将被忽略：{{ preview.ignored.join('、') }}
        </p>
        <div class="import-table">
          <table>
            <thead>
              <tr>
                <th>行号</th>
                <th>操作</th>
                <th>编号</th>
                <th>开发名称</th>
                <th>检查结果</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in preview.rows" :key="r.rowNumber" :class="{ bad: r.errors.length }">
                <td>{{ r.rowNumber }}</td>
                <td>{{ r.action === 'create' ? '新建' : '更新' }}</td>
                <td>{{ r.code ?? '—' }}</td>
                <td>{{ r.name }}</td>
                <td>{{ r.errors.length ? r.errors.join('；') : `通过（${r.fields} 个字段）` }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </div>
    <footer>
      <button type="button" class="secondary-button" :disabled="busy" @click="emit('close')">
        取消</button
      ><button
        type="button"
        class="primary-button"
        :disabled="busy || !preview || !preview.rows.length || !!failed.length"
        @click="confirm"
      >
        {{ busy && preview ? '正在导入…' : '确认导入' }}
      </button>
    </footer>
  </dialog>
</template>
