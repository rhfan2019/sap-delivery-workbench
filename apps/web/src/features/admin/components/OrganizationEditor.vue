<script setup lang="ts">
import { reactive } from 'vue';
import AdminDialog from './AdminDialog.vue';
import type { Customer, AdminProject, Organization } from '../types';
const props = defineProps<{
  kind: 'organization' | 'customer' | 'project';
  record?: Customer | AdminProject | Organization;
  customers: Customer[];
  customerId?: string;
  busy: boolean;
  error: string;
}>();
const emit = defineEmits<{ close: []; save: [body: Record<string, unknown>] }>();
const draft = reactive({
  name: '',
  code: '',
  customerKind: 'external',
  customerId: props.customerId ?? '',
  description: '',
  status: props.kind === 'project' ? 'preparing' : 'active',
  projectType: 'implementation',
  plannedStartDate: '',
  plannedEndDate: '',
  ...props.record,
});
const title =
  (props.record ? '编辑' : '新建') +
  { organization: '企业资料', customer: '客户', project: '项目' }[props.kind];
</script>
<template>
  <AdminDialog
    :title="title"
    :busy="busy"
    :error="error"
    @close="emit('close')"
    @submit="emit('save', { ...draft })"
    ><p class="dialog-description">
      {{
        kind === 'organization'
          ? '企业即组织空间，名称变更不会影响既有数据和成员关系。'
          : kind === 'customer'
            ? '客户用于记录项目服务对象；创建客户不会授予系统访问权限。'
            : '项目承载实际交付，创建后可在用户与成员中分配项目成员。'
      }}
    </p>
    <label for="entity-name"
      >{{ kind === 'organization' ? '企业' : kind === 'customer' ? '客户' : '项目' }}名称
      <span>*</span></label
    ><input id="entity-name" v-model="draft.name" required maxlength="200" autofocus /><template
      v-if="kind !== 'organization'"
      ><div class="field-grid">
        <div>
          <label for="entity-code">编码 <span>*</span></label
          ><input
            id="entity-code"
            v-model="draft.code"
            required
            maxlength="32"
            pattern="[A-Za-z0-9][A-Za-z0-9_-]{0,31}"
            placeholder="英文字母、数字、下划线"
          />
        </div>
        <div>
          <label for="entity-status">状态</label
          ><select id="entity-status" v-model="draft.status">
            <template v-if="kind === 'customer'"
              ><option value="active">正常</option>
              <option value="inactive">已停用</option></template
            ><template v-else
              ><option value="preparing">准备中</option>
              <option value="active">进行中</option>
              <option value="completed">已完成</option>
              <option v-if="record" value="archived">已归档（保存后只读）</option></template
            >
          </select>
        </div>
      </div>
      <template v-if="kind === 'customer'"
        ><label for="customer-kind">客户类型</label
        ><select id="customer-kind" v-model="draft.customerKind">
          <option value="external">外部客户</option>
          <option value="self">企业自身（每个企业仅一条）</option>
        </select></template
      ><template v-else
        ><div class="field-grid">
          <div>
            <label for="project-customer">所属客户 <span>*</span></label
            ><select id="project-customer" v-model="draft.customerId" required :disabled="!!record">
              <option disabled value="">请选择客户</option>
              <option
                v-for="c in customers"
                :key="c.id"
                :value="c.id"
                :disabled="c.status !== 'active'"
              >
                {{ c.name }}{{ c.status !== 'active' ? '（停用）' : '' }}
              </option>
            </select>
          </div>
          <div>
            <label for="project-type">项目类型</label
            ><select id="project-type" v-model="draft.projectType">
              <option value="implementation">实施项目</option>
              <option value="rollout">推广项目</option>
              <option value="enhancement">增强开发</option>
              <option value="support">运维支持</option>
              <option value="migration">数据迁移</option>
              <option value="other">其他</option>
            </select>
          </div>
        </div>
        <div class="field-grid">
          <div>
            <label for="start-date">计划开始</label
            ><input id="start-date" v-model="draft.plannedStartDate" type="date" />
          </div>
          <div>
            <label for="end-date">计划结束</label
            ><input
              id="end-date"
              v-model="draft.plannedEndDate"
              type="date"
              :min="draft.plannedStartDate || undefined"
            />
          </div>
        </div>
        <p v-if="draft.status === 'archived'" class="help-note">
          归档后项目及成员关系将只读，请确认交付工作已完成。
        </p></template
      ><label for="entity-description">说明</label
      ><textarea
        id="entity-description"
        v-model="draft.description"
        rows="3"
        maxlength="4000"
      /></template
  ></AdminDialog>
</template>
