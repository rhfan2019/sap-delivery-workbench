<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue';
import { EditorContent, useEditor } from '@tiptap/vue-3';
import StarterKit from '@tiptap/starter-kit';
import { TableKit } from '@tiptap/extension-table';
import { safeHtml } from './richText';
const props = defineProps<{ modelValue: string; disabled?: boolean; label?: string }>();
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();
const editor = useEditor({
  extensions: [StarterKit.configure({ heading: { levels: [2, 3] }, link: false }), TableKit],
  content: safeHtml(props.modelValue),
  editable: !props.disabled,
  editorProps: {
    attributes: {
      'aria-label': props.label ?? '富文本',
      role: 'textbox',
      'aria-multiline': 'true',
    },
  },
  onUpdate: ({ editor }) => emit('update:modelValue', editor.getHTML()),
});
watch(
  () => props.disabled,
  (value) => editor.value?.setEditable(!value),
);
onBeforeUnmount(() => editor.value?.destroy());
</script>
<template>
  <div class="rich-editor" @keydown.enter.stop>
    <div class="rich-toolbar" role="toolbar" :aria-label="(label ?? '富文本') + '格式'">
      <button
        type="button"
        :disabled="disabled"
        :aria-pressed="editor?.isActive('bold')"
        @click="editor?.chain().focus().toggleBold().run()"
      >
        加粗
      </button>
      <button
        type="button"
        :disabled="disabled"
        :aria-pressed="editor?.isActive('italic')"
        @click="editor?.chain().focus().toggleItalic().run()"
      >
        斜体
      </button>
      <button
        type="button"
        :disabled="disabled"
        @click="editor?.chain().focus().toggleHeading({ level: 2 }).run()"
      >
        小标题
      </button>
      <button
        type="button"
        :disabled="disabled"
        @click="editor?.chain().focus().toggleBulletList().run()"
      >
        项目列表
      </button>
      <button
        type="button"
        :disabled="disabled"
        @click="editor?.chain().focus().toggleOrderedList().run()"
      >
        编号列表
      </button>
      <button
        type="button"
        :disabled="disabled"
        @click="
          editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
        "
      >
        插入表格
      </button>
      <template v-if="editor?.isActive('table')">
        <button
          type="button"
          :disabled="disabled"
          @click="editor?.chain().focus().addRowAfter().run()"
        >
          添加行
        </button>
        <button
          type="button"
          :disabled="disabled"
          @click="editor?.chain().focus().addColumnAfter().run()"
        >
          添加列
        </button>
        <button
          type="button"
          :disabled="disabled"
          @click="editor?.chain().focus().deleteRow().run()"
        >
          删除行
        </button>
        <button
          type="button"
          :disabled="disabled"
          @click="editor?.chain().focus().deleteColumn().run()"
        >
          删除列
        </button>
        <button
          type="button"
          :disabled="disabled"
          @click="editor?.chain().focus().deleteTable().run()"
        >
          删除表格
        </button>
      </template>
      <button
        type="button"
        :disabled="disabled || !editor?.can().undo()"
        @click="editor?.chain().focus().undo().run()"
      >
        撤销
      </button>
      <button
        type="button"
        :disabled="disabled || !editor?.can().redo()"
        @click="editor?.chain().focus().redo().run()"
      >
        重做
      </button>
    </div>
    <EditorContent :editor="editor" class="rich-content" />
  </div>
</template>
