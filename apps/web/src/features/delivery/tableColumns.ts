import type { WorkbenchColumn } from '../../components/workbench-table/types';
import { fields } from './model';

export const tableColumns: WorkbenchColumn[] = [
  { key: 'code', label: '编号', width: 112, fixed: 'left', required: true },
  { key: 'name', label: '开发名称', minWidth: 260, flex: true, required: true },
  { key: 'stage', label: '阶段', width: 112, required: true },
  ...fields
    .filter((f) => f.key !== 'name')
    .map((f) => ({
      key: f.key,
      label: f.label,
      width: f.type === 'rich' ? 300 : f.type === 'date' ? 148 : f.type === 'member' ? 112 : 80,
      hideBelow: ['kind', 'businessOwnerId'].includes(f.key) ? 1280 : undefined,
      visible: [
        'module',
        'kind',
        'priority',
        'businessOwnerId',
        'developerId',
        'plannedDevDate',
      ].includes(f.key),
    })),
  { key: 'actions', label: '操作', width: 124, fixed: 'right', required: true, sortable: false },
];
export const fieldFor = (key: string) => fields.find((f) => f.key === key)!;
export const stageLabel = (stage: string) =>
  ({ fs_draft: 'FS 编写', ready: '待开发' })[stage] || stage;
