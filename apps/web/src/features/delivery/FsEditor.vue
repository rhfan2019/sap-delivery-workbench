<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { askConfirmation } from '../../services/confirmation';
import { api } from '../../services/session';
import { chapters, type Fs, type Item } from './model';
import SapConfigPanel from '../sap/SapConfigPanel.vue';
const props = defineProps<{ path: string; item: Item; writable: boolean }>();
const emit = defineEmits<{ updated: [] }>();
const fs = ref<Fs | null>(null);
const number = ref('');
const sections = ref<Record<string, string>>({});
const active = ref('background');
const busy = ref(false);
const error = ref('');
const notice = ref('');
const selectedVersion = ref('');
const compareVersion = ref('');
const versionNote = ref('');
const dirty = computed(
  () =>
    !!fs.value &&
    (number.value !== (fs.value.fsNumber ?? '') ||
      chapters.some((c) => (sections.value[c.key] ?? '') !== (fs.value!.sections[c.key] ?? ''))),
);
const historical = computed(() => fs.value?.versions.find((v) => v.id === selectedVersion.value));
const comparison = computed(() => fs.value?.versions.find((v) => v.id === compareVersion.value));
const chapter = computed(() => chapters.find((c) => c.key === active.value)!);
const shownSections = computed(() => historical.value?.sections ?? sections.value);
const submitted = computed(() =>
  fs.value?.versions.find((v) => v.id === fs.value?.submittedVersionId),
);
const canEdit = computed(() => props.writable && !historical.value && !busy.value);
function adopt(data: Fs) {
  fs.value = data;
  number.value = data.fsNumber ?? '';
  sections.value = Object.fromEntries(chapters.map((c) => [c.key, data.sections[c.key] ?? '']));
}
async function load() {
  busy.value = true;
  error.value = '';
  try {
    adopt(await api<Fs>(props.path + '/fs'));
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
async function reload() {
  if (dirty.value && !(await askConfirmation('放弃当前未保存的 FS 内容，读取服务器最新草稿？')))
    return;
  await load();
}
async function saveDraft() {
  if (!fs.value) return false;
  adopt(
    await api<Fs>(
      props.path + '/fs',
      { rowVersion: fs.value.rowVersion, fsNumber: number.value, sections: sections.value },
      'PATCH',
    ),
  );
  return true;
}
async function action(kind: 'save' | 'snapshot' | 'submit') {
  if (busy.value || !fs.value) return;
  if (
    kind === 'submit' &&
    !(await askConfirmation('将当前 FS 保存为不可变版本，并设为本开发项的开发依据。确认提交？'))
  )
    return;
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    if (dirty.value && !(await saveDraft())) return;
    if (kind === 'snapshot') {
      await api(props.path + '/fs/versions', {
        rowVersion: fs.value.rowVersion,
        note: versionNote.value,
      });
      adopt(await api<Fs>(props.path + '/fs'));
      versionNote.value = '';
    } else if (kind === 'submit') {
      adopt(
        await api<Fs>(props.path + '/fs/submit', {
          rowVersion: fs.value.rowVersion,
          itemVersion: props.item.rowVersion,
        }),
      );
    }
    notice.value =
      kind === 'save'
        ? '草稿已保存'
        : kind === 'snapshot'
          ? '只读版本已保存'
          : 'FS 已提交为开发基线';
    emit('updated');
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
function downloadDraft() {
  const content = [
    'FS 编号：' + number.value,
    ...chapters.map((c) => c.label + '\n' + (sections.value[c.key] ?? '')),
  ].join('\n\n');
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = props.item.code + '-FS-草稿.txt';
  a.click();
  URL.revokeObjectURL(url);
}
defineExpose({ dirty, busy });
onMounted(load);
</script>
<template>
  <div class="fs-editor">
    <details class="sap-fs-panel">
      <summary>SAP 系统参数 · 项目默认 / 个人参数 / 本次修改</summary>
      <SapConfigPanel
        :key="path"
        :path="path.split('/development-items/')[0] + '/sap'"
        mode="temporary"
      />
    </details>
    <div class="fs-banner">
      <strong>功能规格说明书</strong
      ><span>{{ dirty ? '有未保存修改' : '手工编写 · 版本可追溯' }}</span>
    </div>
    <p v-if="error" class="error-note" role="alert">
      {{ error }} <button @click="reload" :disabled="busy">读取最新草稿</button
      ><button @click="downloadDraft">导出本地内容</button>
    </p>
    <p v-if="notice" class="delivery-success" role="status">{{ notice }}</p>
    <p v-if="!fs" class="delivery-empty">
      {{ busy ? '正在读取 FS…' : 'FS 读取失败' }} <button v-if="!busy" @click="load">重试</button>
    </p>
    <template v-else>
      <div class="fs-meta">
        <label
          >FS 编号<input
            :value="historical?.fsNumber ?? number"
            @input="number = ($event.target as HTMLInputElement).value"
            :disabled="!canEdit"
            maxlength="100"
            placeholder="例如 FS-MM-001"
        /></label>
        <div>
          <small>开发依据</small
          ><strong>{{
            submitted ? 'V' + submitted.number + ' · ' + submitted.fsNumber : '尚未提交'
          }}</strong>
        </div>
      </div>
      <div class="fs-version-bar">
        <label
          >查看版本<select v-model="selectedVersion">
            <option value="">当前草稿</option>
            <option v-for="v in fs.versions" :key="v.id" :value="v.id">
              V{{ v.number }} · {{ v.note || '保存版本' }}
            </option>
          </select></label
        ><label
          >对比版本<select v-model="compareVersion">
            <option value="">不对比</option>
            <option v-for="v in fs.versions" :key="v.id" :value="v.id">
              V{{ v.number }} · {{ v.note || '保存版本' }}
            </option>
          </select></label
        >
      </div>
      <p v-if="historical" class="delivery-hint">
        只读 V{{ historical.number }} · {{ historical.fsNumber }} · {{ historical.authorName }} ·
        {{ new Date(historical.createdAt).toLocaleString() }}。选择“当前草稿”继续编辑。
      </p>
      <p v-else-if="!writable" class="delivery-hint">
        当前仅可阅读，FS 由业务负责人或项目内企业管理员维护。
      </p>
      <div class="fs-workspace">
        <nav aria-label="FS 章节">
          <button
            v-for="(c, index) in chapters"
            :key="c.key"
            :class="{ active: active === c.key }"
            @click="active = c.key"
          >
            <span>{{ String(index + 1).padStart(2, '0') }} {{ c.label }}</span
            ><span>{{ shownSections[c.key]?.trim() ? '●' : '○' }}</span>
          </button>
        </nav>
        <div class="fs-chapter">
          <h3>{{ chapter.label }}</h3>
          <p class="delivery-hint">{{ chapter.hint }}</p>
          <div :class="{ 'fs-comparison': comparison }">
            <div>
              <small>{{ historical ? 'V' + historical.number : '当前草稿' }}</small
              ><textarea
                v-if="!historical"
                v-model="sections[active]"
                :aria-label="chapter.label"
                :readonly="!canEdit"
                maxlength="30000"
                :placeholder="chapter.hint"
                rows="17"
              />
              <pre v-else>{{ shownSections[active] || '本章未填写' }}</pre>
            </div>
            <div v-if="comparison">
              <small
                >V{{ comparison.number }} ·
                {{
                  (shownSections[active] ?? '') === (comparison.sections[active] ?? '')
                    ? '内容相同'
                    : '内容有变更'
                }}</small
              >
              <pre>{{ comparison.sections[active] || '本章未填写' }}</pre>
            </div>
          </div>
        </div>
      </div>
      <div v-if="!historical && writable" class="fs-actions">
        <button class="primary-button" :disabled="busy || !dirty" @click="action('save')">
          {{ busy ? '处理中…' : '保存草稿' }}</button
        ><input
          v-model="versionNote"
          aria-label="版本说明"
          placeholder="版本说明（可选）"
          maxlength="500"
        /><button :disabled="busy" @click="action('snapshot')">保存版本</button
        ><button :disabled="busy" @click="action('submit')">提交开发</button>
      </div>
      <p class="delivery-hint">
        提交要求：FS
        编号、业务规则、验收条件、初版测试案例、有效业务及开发负责人，且无阻塞。保存草稿不改变已提交版本。
      </p>
    </template>
  </div>
</template>
