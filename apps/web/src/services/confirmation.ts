import { ref } from 'vue';
export const confirmation = ref<{ message: string; resolve: (answer: boolean) => void } | null>(
  null,
);
export function askConfirmation(message: string): Promise<boolean> {
  if (confirmation.value) return Promise.resolve(false);
  return new Promise((resolve) => {
    confirmation.value = { message, resolve };
  });
}
export function answerConfirmation(answer: boolean) {
  const pending = confirmation.value;
  confirmation.value = null;
  pending?.resolve(answer);
}
