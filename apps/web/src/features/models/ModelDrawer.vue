<script setup lang="ts">
import { computed, ref } from 'vue';
import { KeyRound, ChevronDown, Play } from '@lucide/vue';
import SettingsDrawer from '../settings/SettingsDrawer.vue';
import type { ModelRecord, ModelConfig } from './types';
// A model's configuration in the list's drawer (DESIGN.md 5 “抽屉”): a saved one opens to read
// unless its 编辑 was clicked (development-discipline.md 4.1).
const props = defineProps<{
  record: ModelRecord | null;
  edit?: boolean;
  busy: boolean;
  error: string;
  pagePosition: { left: number; top: number };
}>();
const emit = defineEmits<{
  close: [];
  save: [body: ModelConfig & { apiKey: string; rowVersion?: string }];
  test: [];
}>();
const form = ref<ModelConfig>({
  name: props.record?.name ?? '',
  provider: props.record?.provider ?? '',
  protocol: props.record?.protocol ?? 'openai_chat',
  baseUrl: props.record?.baseUrl ?? '',
  modelId: props.record?.modelId ?? '',
});
const initial = JSON.stringify(form.value),
  apiKey = ref(''),
  replaceKey = ref(!props.record);
const dirty = computed(
  () =>
    JSON.stringify(form.value) !== initial ||
    apiKey.value !== '' ||
    (!props.record && form.value.name !== ''),
);
const reading = ref(!!props.record && !props.edit);
function startEdit() {
  reading.value = false;
}
function cancel() {
  if (!props.record) return emit('close');
  form.value = JSON.parse(initial);
  apiKey.value = '';
  replaceKey.value = false;
  reading.value = true;
}
function submit() {
  emit('save', {
    ...form.value,
    apiKey: apiKey.value,
    rowVersion: props.record?.rowVersion,
  });
}
defineExpose({ dirty, startEdit });
</script>
<template>
  <SettingsDrawer
    :title="record?.name ?? '添加模型'"
    :description="record ? record.provider + ' · ' + record.modelId : '维护模型接入信息。'"
    close-label="关闭模型抽屉"
    note="密钥加密存储"
    :busy="busy"
    :reading="reading"
    editable
    @close="emit('close')"
    @submit="submit"
    @edit="startEdit"
  >
    <p v-if="error" class="error-note" role="alert">{{ error }}</p>
    <p v-if="record?.isDefault && !reading" class="s-drawer-note">
      修改将保存为新版本。测试后点击“应用已验证修改”，当前默认版本才会切换。
    </p>
    <fieldset class="s-fields" :class="{ reading }" :disabled="reading">
      <section>
        <h3>基本信息</h3>
        <label class="s-field"
          ><span>模型名称 <b>*</b></span
          ><input
            v-model="form.name"
            required
            maxlength="100"
            autofocus
            placeholder="例如：通用模型"
            :disabled="busy"
        /></label>
        <label class="s-field"
          ><span>提供方 <b>*</b></span
          ><input
            v-model="form.provider"
            required
            maxlength="100"
            placeholder="例如：DeepSeek"
            :disabled="busy"
        /></label>
        <label class="s-field"
          ><span>API 协议 <b>*</b></span
          ><select v-model="form.protocol" :disabled="busy">
            <option value="openai_chat">OpenAI Chat</option>
            <option value="openai_responses">OpenAI Responses</option>
            <option value="anthropic_messages">Anthropic Messages</option>
          </select></label
        >
        <label class="s-field"
          ><span>模型标识 <b>*</b></span
          ><input
            v-model="form.modelId"
            required
            maxlength="200"
            placeholder="提供方的模型 ID"
            :disabled="busy"
        /></label>
      </section>
      <section>
        <h3>接入配置</h3>
        <label class="s-field"
          ><span>接入地址 <b>*</b></span
          ><input
            v-model="form.baseUrl"
            type="url"
            required
            placeholder="https://api.example.com/v1"
            :disabled="busy"
        /></label>
        <p class="s-drawer-help">
          填写 API 基础地址，不含 /chat/completions 等操作路径。测试仅允许部署白名单内的公网 HTTPS
          服务。
        </p>
        <label v-if="replaceKey" class="s-field"
          ><span>API 密钥 <b>*</b></span
          ><input
            v-model="apiKey"
            type="password"
            :required="!record || replaceKey"
            maxlength="4096"
            autocomplete="new-password"
            placeholder="输入此服务的 API Key"
            :disabled="busy"
        /></label>
        <div v-else class="model-secret">
          <span>API 密钥</span><span><KeyRound :size="14" /> 已配置 · ••••••••</span
          ><button
            type="button"
            class="text-button s-edit-only"
            :disabled="busy"
            @click="replaceKey = true"
          >
            更换
          </button>
        </div>
        <button
          v-if="record && replaceKey"
          type="button"
          class="text-button model-cancel-key"
          :disabled="busy"
          @click="
            replaceKey = false;
            apiKey = '';
          "
        >
          保留现有密钥
        </button>
      </section>
    </fieldset>

    <details class="model-help">
      <summary>保存与验证说明 <ChevronDown :size="14" /></summary>
      <p>
        保存不会发送业务数据，也不会自动切换默认模型。测试将发送一条固定合成文本，可能产生少量模型调用费用；仅验证文本生成。
      </p>
    </details>
    <div v-if="record" class="model-probe-strip">
      <span>{{
        record.test?.status === 'passed'
          ? '测试通过'
          : record.test?.status === 'running'
            ? '测试中'
            : record.test
              ? '测试未通过'
              : '尚未测试'
      }}</span
      ><button
        type="button"
        class="secondary-button"
        :disabled="busy || dirty"
        @click="emit('test')"
      >
        <Play :size="14" /> 测试连接
      </button>
    </div>
    <p v-if="record?.test" class="s-drawer-help" role="status">{{ record.test.message }}</p>
    <template #actions>
      <button type="button" class="secondary-button" :disabled="busy" @click="cancel">取消</button
      ><button class="primary-button" :disabled="busy">
        {{ busy ? '正在处理…' : '保存配置' }}
      </button>
    </template>
  </SettingsDrawer>
</template>
