import { defineAsyncComponent, defineComponent, h, type PropType } from 'vue';
import DOMPurify from 'dompurify';

// Retain the platform's passive HTML whitelist. Raw model HTML never creates
// images, frames, forms, scripts, event handlers or arbitrary style attributes.
const SafeHtml = defineComponent({
  props: { node: { type: Object as PropType<{ value: string }>, required: true } },
  setup: (props) => () =>
    h('span', {
      innerHTML: DOMPurify.sanitize(props.node.value, {
        ALLOWED_TAGS: [
          'p',
          'br',
          'strong',
          'em',
          'del',
          'blockquote',
          'ul',
          'ol',
          'li',
          'h1',
          'h2',
          'h3',
          'h4',
          'h5',
          'h6',
          'pre',
          'code',
          'a',
          'table',
          'thead',
          'tbody',
          'tr',
          'th',
          'td',
          'hr',
        ],
        ALLOWED_ATTR: ['href', 'title', 'colspan', 'rowspan'],
      }),
    }),
});
const PassiveImage = defineComponent({
  props: { node: { type: Object as PropType<{ alt?: string }>, required: true } },
  setup: (props) => () =>
    h(
      'span',
      { class: 'text-muted-foreground' },
      props.node.alt ? `[图片：${props.node.alt}]` : '[图片]',
    ),
});
export const assistantMarkdownRenderers = {
  html: SafeHtml,
  image: PassiveImage,
  imageReference: PassiveImage,
  code: defineAsyncComponent(() => import('./MarkdownCode.vue')),
};
