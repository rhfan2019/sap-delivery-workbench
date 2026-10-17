import { ref } from 'vue';

// Short confirmations shown bottom right by BaseToaster (DESIGN.md 5); each lasts 3 seconds.
export interface Toast {
  id: number;
  text: string;
  tone: 'neutral' | 'green' | 'red';
}
export const toasts = ref<Toast[]>([]);
let next = 1;
export function toast(text: string, tone: Toast['tone'] = 'neutral') {
  const id = next++;
  toasts.value = [...toasts.value, { id, text, tone }];
  setTimeout(() => dismiss(id), 3000);
}
export function dismiss(id: number) {
  toasts.value = toasts.value.filter((t) => t.id !== id);
}
