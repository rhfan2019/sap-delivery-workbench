<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { confirmation, answerConfirmation } from '../services/confirmation';
const dialog = ref<HTMLDialogElement | null>(null);
let previous: HTMLElement | null = null;
watch(
  confirmation,
  async (value) => {
    if (value) {
      previous = document.activeElement as HTMLElement;
      await nextTick();
      dialog.value?.showModal();
      dialog.value?.querySelector('button')?.focus();
    } else {
      await nextTick();
      previous?.focus();
    }
  },
  { immediate: true },
);
function trap(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault();
    answerConfirmation(false);
  }
  if (event.key === 'Tab') {
    event.preventDefault();
    const buttons = dialog.value?.querySelectorAll('button');
    if (buttons?.length) (document.activeElement === buttons[0] ? buttons[1] : buttons[0])?.focus();
  }
}
</script>
<template>
  <Teleport to="body"
    ><dialog
      v-if="confirmation"
      ref="dialog"
      class="confirm-scrim"
      aria-labelledby="confirm-heading"
      aria-describedby="confirm-message"
      @cancel.prevent="answerConfirmation(false)"
    >
      <section
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-heading"
        aria-describedby="confirm-message"
        @keydown="trap"
      >
        <h2 id="confirm-heading">确认操作</h2>
        <p id="confirm-message">{{ confirmation.message }}</p>
        <div>
          <button class="secondary-button" @click="answerConfirmation(false)">
            取消，保留当前内容</button
          ><button class="primary-button" @click="answerConfirmation(true)">确认继续</button>
        </div>
      </section>
    </dialog></Teleport
  >
</template>
<style scoped>
.confirm-scrim {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: #0a224080;
  display: grid;
  place-items: center;
  padding: 24px;
  width: 100vw;
  height: 100dvh;
  max-width: none;
  max-height: none;
  border: 0;
  margin: 0;
  box-sizing: border-box;
}
.confirm-scrim::backdrop {
  background: transparent;
}
.confirm-scrim section {
  background: white;
  max-width: 480px;
  border-radius: 12px;
  padding: 26px;
  color: #0a2240;
  box-shadow: 0 16px 60px #0a224040;
}
.confirm-scrim h2 {
  font-size: 19px;
  margin: 0;
}
.confirm-scrim p {
  font-size: 14px;
  line-height: 1.8;
  margin: 16px 0 24px;
}
.confirm-scrim section > div {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
</style>
