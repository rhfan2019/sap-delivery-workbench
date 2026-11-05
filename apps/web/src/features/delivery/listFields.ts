import type { ListField } from '../../components/list-report/types';
import {
  GROUPS,
  OPTIONS,
  PHASES,
  columnLabel,
  fieldValue,
  memberName,
  richText,
  type FieldDef,
  type Item,
  type ListContext,
} from './model';

// The development list's filterable fields, from its field catalog (docs/modules/list-report.md 2).
const ON_BAR = new Set([
  'module',
  'kind',
  'priority',
  'development.status',
  'development.assigneeId',
  'development.plannedEnd',
  'tags',
]);
const fromMap = (options: Record<string, string>) =>
  Object.entries(options).map(([value, label]) => ({ value, label }));

export function listFields(fields: FieldDef[], ctx: ListContext): ListField<Item>[] {
  const memberOptions = ctx.members.map((m) => ({ value: m.id, label: memberName(m.id, ctx) }));
  const groupName = (key: string) => GROUPS.find((g) => g.key === key)?.label ?? key;
  const raw = (key: string) => (item: Item) => fieldValue(item, key);
  const list = fields.flatMap((f): ListField<Item>[] => {
    const base = {
      key: f.key,
      label: columnLabel(f),
      group: groupName(f.group),
      defaultFilter: ON_BAR.has(f.key),
      value: raw(f.key),
    };
    const kind = f.type === 'custom' ? f.customType : f.type;
    switch (kind) {
      case 'select':
      case 'multi_select': {
        const options = Array.isArray(f.options)
          ? (f.options as { id: string; label: string }[]).map((o) => ({
              value: o.id,
              label: o.label,
            }))
          : fromMap((f.options ?? {}) as Record<string, string>);
        return [{ ...base, type: 'select', options, emptyLabel: '未填写' }];
      }
      case 'member':
        return [{ ...base, type: 'select', options: memberOptions, emptyLabel: '未分配' }];
      case 'tags':
        return [
          {
            ...base,
            type: 'select',
            options: ctx.tags.map((t) => ({ value: t.id, label: t.name })),
            emptyLabel: '无标签',
          },
        ];
      case 'date':
        return [{ ...base, type: 'date' }];
      case 'percent':
      case 'effort':
      case 'number':
        return [{ ...base, type: 'number' }];
      case 'checkbox':
        return [
          {
            ...base,
            type: 'select',
            options: [
              { value: 'true', label: '是' },
              { value: 'false', label: '否' },
            ],
            value: (item) => fieldValue(item, f.key) === true,
          },
        ];
      case 'rich':
      case 'long_text':
        return [
          {
            ...base,
            type: 'text',
            value: (item) => richText(String(fieldValue(item, f.key) ?? '')),
          },
        ];
      case 'objects':
        return [
          {
            ...base,
            type: 'text',
            value: (item) => item.objects.map((o) => `${o.objectType} ${o.objectName}`),
          },
        ];
      default:
        return [{ ...base, type: 'text' }];
    }
  });
  const phases = '跨阶段';
  return [
    ...list,
    {
      key: '_anyStatus',
      label: '任一阶段状态',
      group: phases,
      type: 'select',
      options: fromMap(OPTIONS.status),
      value: (item) => PHASES.map((p) => item.phases[p.key].status),
    },
    {
      key: '_anyAssignee',
      label: '任一阶段负责人',
      group: phases,
      type: 'select',
      options: memberOptions,
      emptyLabel: '未分配',
      value: (item) => PHASES.map((p) => item.phases[p.key].assigneeId),
    },
  ];
}
