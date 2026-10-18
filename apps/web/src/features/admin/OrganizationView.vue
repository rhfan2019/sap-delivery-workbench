<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import BaseSkeleton from '../../components/base/BaseSkeleton.vue';
import { toast } from '../../components/base/toast';
import { can, restoreSession } from '../../services/session';
import SettingsPage from '../settings/SettingsPage.vue';
import SettingsCard from '../settings/SettingsCard.vue';
import SettingsField from '../settings/SettingsField.vue';
import { useLoad, useSave } from '../settings/useLoad';
import { adminApi } from './api';
import '../settings/settings.css';

// 企业 → 企业资料 (Plain's General).
const { data: org, loading, error, reload } = useLoad(adminApi.organization);
const name = ref('');
const code = ref('');
watch(org, (o) => {
  name.value = o?.name ?? '';
  code.value = o?.code ?? '';
});
onMounted(reload);
const save = useSave();
async function submit() {
  const saved = await save.run(() =>
    adminApi.saveOrganization({
      name: name.value,
      code: code.value,
      rowVersion: org.value!.rowVersion,
    }),
  );
  if (saved) {
    org.value = saved;
    await restoreSession();
    toast('企业资料已保存。', 'green');
  }
}
const editable = computed(() => can('org.profile:edit'));
</script>
<template>
  <SettingsPage
    title="企业资料"
    description="团队所属企业的信息；企业是账号、项目与配置的组织空间。"
  >
    <p v-if="error" class="s-error" role="alert">{{ error }}</p>
    <BaseSkeleton v-if="loading && !org" height="140px" />
    <SettingsCard
      v-if="org"
      title="企业"
      :editable="editable"
      :dirty="name !== org.name || code !== org.code"
      :saving="save.busy.value"
      :error="save.error.value"
      @save="submit"
    >
      <SettingsField label="企业名称" for="org-name" help="显示在菜单顶部与导出文件中。">
        <input id="org-name" v-model="name" class="s-input" maxlength="200" :disabled="!editable" />
      </SettingsField>
      <SettingsField
        label="企业编码"
        for="org-code"
        help="英文字母、数字、下划线或连字符，保存时转为大写。"
      >
        <input
          id="org-code"
          v-model="code"
          class="s-input mono"
          maxlength="32"
          :disabled="!editable"
        />
      </SettingsField>
    </SettingsCard>
  </SettingsPage>
</template>
