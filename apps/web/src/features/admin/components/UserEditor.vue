<script setup lang="ts">
import { reactive } from 'vue';
import AdminDialog from './AdminDialog.vue';
import type { AdminUser } from '../types';
const props = defineProps<{
  mode: 'create' | 'account' | 'member';
  user?: AdminUser;
  self?: boolean;
  busy: boolean;
  error: string;
}>();
const emit = defineEmits<{ close: []; save: [body: Record<string, unknown>] }>();
const draft = reactive({
  loginName: props.user?.loginName ?? '',
  displayName: props.user?.displayName ?? '',
  email: props.user?.email ?? '',
  status:
    props.mode === 'member'
      ? (props.user?.memberStatus ?? 'active')
      : (props.user?.status ?? 'active'),
  accessLevel: props.user?.accessLevel ?? 'member',
  rowVersion: props.mode === 'member' ? props.user?.memberVersion : props.user?.rowVersion,
});
</script>
<template>
  <AdminDialog
    :title="mode === 'create' ? '新建用户' : mode === 'member' ? '管理企业成员' : '编辑用户账号'"
    :busy="busy"
    :error="error"
    @close="emit('close')"
    @submit="emit('save', { ...draft })"
    ><p class="dialog-description">
      {{
        mode === 'create'
          ? '新用户默认加入当前企业，身份为普通成员。系统生成一次性临时密码，首次登录须修改。'
          : mode === 'member'
            ? '企业成员资格与账号状态独立。停用企业成员会撤销当前企业会话，并移出其项目。'
            : '账号停用后不能登录；历史业务记录与成员关系将保留。'
      }}
    </p>
    <template v-if="mode !== 'member'"
      ><label for="user-login">登录账号 <span>*</span></label
      ><input
        id="user-login"
        v-model="draft.loginName"
        required
        minlength="3"
        maxlength="64"
        pattern="[A-Za-z0-9][A-Za-z0-9._-]{2,63}"
        :disabled="mode !== 'create'"
        autocomplete="off"
        placeholder="如 chen.siyuan" /><label for="user-name">姓名 <span>*</span></label
      ><input id="user-name" v-model="draft.displayName" required maxlength="100" /><label
        for="user-email"
        >邮箱</label
      ><input
        id="user-email"
        v-model="draft.email"
        type="email"
        maxlength="254"
        placeholder="选填，用于联系信息" /></template
    ><template v-else
      ><div class="member-identity">
        <span class="avatar">{{ user?.displayName.slice(0, 1) }}</span>
        <div>
          <strong>{{ user?.displayName }}</strong>
          <p>{{ user?.loginName }}</p>
        </div>
      </div>
      <label for="access-level">企业管理身份</label
      ><select id="access-level" v-model="draft.accessLevel" :disabled="self">
        <option value="member">普通成员</option>
        <option value="admin">企业管理员</option>
      </select>
      <p v-if="draft.accessLevel === 'admin'" class="help-note">
        企业管理员可维护客户、项目、用户及成员关系，请仅授予可信管理人员。
      </p></template
    ><template v-if="mode !== 'create'"
      ><label for="user-status">{{ mode === 'member' ? '企业成员状态' : '账号状态' }}</label
      ><select id="user-status" v-model="draft.status" :disabled="self">
        <option value="active">正常</option>
        <option value="disabled">已停用</option>
      </select>
      <p v-if="draft.status === 'disabled'" class="help-note">
        {{
          mode === 'member'
            ? '保存后撤销本企业访问，移出所有项目。重新启用不会恢复项目成员关系。'
            : '保存后立即撤销该账号的登录会话。'
        }}
      </p>
      <p v-if="self" class="help-note">
        为避免失去管理入口，当前管理员不能停用或降级自己。
      </p></template
    ></AdminDialog
  >
</template>
