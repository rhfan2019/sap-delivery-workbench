<script setup lang="ts">
defineOptions({ name: 'StructuredEditor' });
import { computed } from 'vue';
import { resolveSchema, newArrayItem } from './editor-schema.mjs';
const props = defineProps<{
  modelValue: any;
  label?: string;
  disabled?: boolean;
  schema?: any;
  rootSchema?: any;
  document?: any;
}>();
const node = computed(() => resolveSchema(props.schema, props.rootSchema));
const emit = defineEmits<{ 'update:modelValue': [value: any] }>();
const labels: Record<string, string> = {
  title: '标题',
  description: '说明',
  requirements: '需求',
  fields: '字段合同',
  rules: '业务规则',
  testCases: '测试案例',
  issues: '待确认事项',
  consultantDetails: '顾问说明',
  sources: '来源',
  contract: '输入输出合同',
  businessLabel: '业务名称',
  name: '名称',
  value: '内容',
  status: '状态',
  reason: '理由',
  expected: '预期结果',
  sapObjects: 'SAP 对象',
  systemContext: '系统信息',
  evidence: '证据',
  notes: '备注',
};
function change(value: any, key: string | number, next: any) {
  emit(
    'update:modelValue',
    Array.isArray(value) ? value.map((v, i) => (i === key ? next : v)) : { ...value, [key]: next },
  );
}
</script>
<template>
  <div class="structured-field">
    <details v-if="modelValue !== null && typeof modelValue === 'object'" open>
      <summary>
        {{ label || '说明书内容'
        }}{{ Array.isArray(modelValue) ? `（${modelValue.length} 项）` : '' }}
      </summary>
      <template v-if="Array.isArray(modelValue)">
        <div v-for="(value, index) in modelValue" :key="index" class="structured-entry">
          <StructuredEditor
            :model-value="value"
            :label="`第 ${index + 1} 项`"
            :disabled="disabled"
            :schema="node.items"
            :root-schema="rootSchema"
            :document="document"
            @update:model-value="change(modelValue, index, $event)"
          />
          <button
            v-if="!disabled"
            type="button"
            @click="
              emit(
                'update:modelValue',
                modelValue.filter((_: any, i: number) => i !== index),
              )
            "
          >
            删除此项
          </button>
        </div>
        <button
          v-if="!disabled"
          type="button"
          @click="
            emit('update:modelValue', [...modelValue, newArrayItem(node, rootSchema, document)])
          "
        >
          新增一项
        </button>
      </template>
      <StructuredEditor
        v-for="(value, key) in !Array.isArray(modelValue) ? modelValue : {}"
        :key="key"
        :label="labels[String(key)] || String(key)"
        :model-value="value"
        :schema="node.properties?.[key]"
        :root-schema="rootSchema"
        :document="document"
        :disabled="
          disabled ||
          [
            'systemContext',
            'evidence',
            'specId',
            'revision',
            'verificationStatus',
            'verificationScope',
            'evidenceIds',
          ].includes(String(key))
        "
        @update:model-value="change(modelValue, String(key), $event)"
      />
    </details>
    <label v-else-if="typeof modelValue === 'boolean'"
      ><input
        type="checkbox"
        :checked="modelValue"
        :disabled="disabled"
        @change="emit('update:modelValue', ($event.target as HTMLInputElement).checked)"
      />{{ label }}</label
    >
    <label v-else-if="typeof modelValue === 'number'"
      >{{ label
      }}<input
        type="number"
        :value="modelValue"
        :disabled="disabled"
        @input="emit('update:modelValue', Number(($event.target as HTMLInputElement).value))"
    /></label>
    <label v-else
      >{{ label
      }}<textarea
        :value="modelValue ?? ''"
        :disabled="disabled"
        rows="2"
        @input="
          emit(
            'update:modelValue',
            ($event.target as HTMLTextAreaElement).value || (modelValue === null ? null : ''),
          )
        "
      />
    </label>
  </div>
</template>
