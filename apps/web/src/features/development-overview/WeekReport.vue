<script setup lang="ts">
import { computed } from 'vue';
import { Copy } from '@lucide/vue';
import { PHASES, type PhaseKey } from '@sap-delivery-workbench/contracts/delivery/fields';
import BaseButton from '../../components/base/BaseButton.vue';
import BaseDialog from '../../components/base/BaseDialog.vue';
import { toast } from '../../components/base/toast';
import { shortDate, type Overview } from './model';

// The weekly report draft (spec section 5): built from this week's history for the internal
// weekly meeting, never for the customer. The text is a draft to copy and edit.
const open = defineModel<boolean>('open', { default: false });
const props = defineProps<{ data: Overview }>();
const phaseLabel = (key: PhaseKey) => PHASES.find((p) => p.key === key)?.label ?? key;
const text = computed(() => {
  const d = props.data;
  const w = d.week;
  const lines = [`开发周报（${shortDate(w.from)} ～ ${shortDate(w.to)}）`, ''];
  const list = (title: string, rows: string[]) => {
    lines.push(`${title}：${rows.length} 项`);
    for (const r of rows.slice(0, 20)) lines.push(`  - ${r}`);
    if (rows.length > 20) lines.push(`  - 另有 ${rows.length - 20} 项`);
  };
  list(
    '本周完成的阶段',
    w.completed.map((x) => `${x.code} ${x.name}（${phaseLabel(x.phase)}）`),
  );
  list(
    '本周新增开发项',
    w.created.map((x) => `${x.code} ${x.name}`),
  );
  list(
    '计划后推',
    w.pushed.map((x) => `${x.code} ${x.name}：${phaseLabel(x.phase)}后推 ${x.days} 天`),
  );
  list(
    '下周到期',
    w.due.map((x) => `${x.code} ${x.name}（${phaseLabel(x.phase)}，${shortDate(x.plannedEnd)}）`),
  );
  lines.push(
    `当前风险：${d.cards.risk.count} 项（已申报延误 ${d.cards.risk.declared}，逾期未更新 ${d.cards.risk.stale}）`,
  );
  if (d.cards.freeze.date)
    lines.push(
      `开发冻结 ${shortDate(d.cards.freeze.date)}：开发计划晚于冻结 ${d.cards.freeze.count} 项`,
    );
  lines.push(
    `开发完成 ${d.counts.developmentDone} / ${d.counts.items}，交付完成 ${d.counts.deliveryDone} / ${d.counts.items}`,
  );
  return lines.join('\n');
});
async function copy() {
  try {
    await navigator.clipboard.writeText(text.value);
    toast('周报草稿已复制。', 'green');
  } catch {
    toast('无法写入剪贴板，请手动选择文字复制。', 'red');
  }
}
</script>
<template>
  <BaseDialog
    v-model:open="open"
    title="周报草稿"
    description="由本周的变更记录自动生成，供内部周会使用；复制后按需修改。"
    wide
  >
    <textarea class="report" readonly :value="text" aria-label="周报草稿"></textarea>
    <template #footer>
      <BaseButton variant="primary" @click="copy"><Copy />复制</BaseButton>
    </template>
  </BaseDialog>
</template>
<style scoped>
.report {
  width: 100%;
  min-height: 320px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-6);
  background: var(--page);
  color: var(--text);
  padding: var(--space-3);
  font-family: var(--font-sans);
  font-size: var(--font-14);
  line-height: var(--leading-24);
  resize: vertical;
}
</style>
