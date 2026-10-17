import type { WorkbenchColumn } from '../../components/workbench-table/types';
import { columnLabel, type FieldDef } from './model';

const defaultVisible = new Set([
  'module',
  'kind',
  'priority',
  'fsd.assigneeId',
  'fsd.status',
  'development.assigneeId',
  'development.status',
  'consultant_test.status',
  'user_test.status',
]);
const widthOf = (f: FieldDef) =>
  f.type === 'rich' || f.type === 'objects' || f.customType === 'long_text'
    ? 240
    : f.type === 'tags'
      ? 160
      : f.type === 'date' || f.customType === 'date'
        ? 128
        : f.type === 'percent'
          ? 124
          : f.key.endsWith('.status')
            ? 132
            : f.type === 'member' || f.customType === 'member'
              ? 120
              : f.type === 'select' || f.type === 'effort'
                ? 80
                : 140;

// Table columns follow the field catalog; a narrow actions column on the right holds the
// hover action bar (design, development, more).
export function tableColumns(fields: FieldDef[]): WorkbenchColumn[] {
  return [
    { key: 'code', label: '编号', width: 84, fixed: 'left', required: true, group: 'basic' },
    {
      key: 'name',
      label: '开发名称',
      minWidth: 220,
      flex: true,
      required: true,
      fixed: 'left',
      group: 'basic',
    },
    ...fields
      .filter((f) => !['code', 'name'].includes(f.key))
      .map((f) => ({
        key: f.key,
        label: columnLabel(f),
        width: widthOf(f),
        group: f.group,
        visible: defaultVisible.has(f.key),
        sortable: !['tags', 'objects'].includes(f.type),
      })),
    { key: 'actions', label: '操作', width: 104, fixed: 'right', required: true, sortable: false },
  ];
}
