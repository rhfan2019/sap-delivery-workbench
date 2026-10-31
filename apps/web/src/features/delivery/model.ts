import {
  FIELDS,
  PHASES,
  GROUPS,
  OPTIONS,
  customField,
  fieldValue,
  richText,
  type FieldDef,
  type CustomFieldDefinition,
  type PhaseKey,
} from '@sap-delivery-workbench/contracts/delivery/fields';
import { phaseRisk } from '@sap-delivery-workbench/contracts/delivery/overview';

export { FIELDS, PHASES, GROUPS, OPTIONS, fieldValue, richText };
export type { FieldDef, CustomFieldDefinition, PhaseKey };

export interface Phase {
  assigneeId: string | null;
  effortDays: number | null;
  plannedStart: string | null;
  plannedEnd: string | null;
  actualStart: string | null;
  actualEnd: string | null;
  progress: number;
  status: string;
  notes: string;
}
export interface SapObject {
  pgmid: string;
  objectType: string;
  objectName: string;
}
export interface Item {
  id: string;
  code: string;
  itemNo: number;
  rowVersion: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  module: string;
  kind: string;
  name: string;
  businessFunction: string;
  priority: string;
  difficulty: string;
  changeType: string;
  registeredOn: string;
  businessOwner: string;
  notes: string;
  transactionCode: string;
  phases: Record<PhaseKey, Phase>;
  objects: SapObject[];
  tags: string[];
  custom: Record<string, unknown>;
}
export interface Member {
  id: string;
  displayName: string;
  active: boolean;
}
export interface Tag {
  id: string;
  name: string;
  color: string;
  usage: number;
}
export interface ListContext {
  members: Member[];
  tags: Tag[];
  // The code freeze date of the project (docs/specs/project-access-admin.md 1.3), if planned.
  codeFreeze?: string | null;
}
export type Changes = Record<string, unknown>;

export const phaseLabel = Object.fromEntries(PHASES.map((p) => [p.key, p.label])) as Record<
  PhaseKey,
  string
>;

// Built-in fields followed by live custom columns, each placed in its group.
export function catalog(custom: CustomFieldDefinition[], { archived = false } = {}): FieldDef[] {
  const extra = custom.filter((f) => archived || !f.archivedAt).map(customField);
  return GROUPS.flatMap((g) => [
    ...FIELDS.filter((f) => f.group === g.key),
    ...extra.filter((f) => f.group === g.key),
  ]);
}

// Table header text: phase fields carry their phase so "状态" stays unambiguous.
export function columnLabel(field: FieldDef) {
  if (!field.phase || field.type === 'member') return field.label;
  return phaseLabel[field.phase] + field.label.replace(/日期$/, '');
}

export const editableInline = (field: FieldDef) =>
  ['text', 'select', 'member', 'date', 'percent', 'effort'].includes(field.type) ||
  (field.type === 'custom' &&
    ['text', 'number', 'date', 'select', 'member', 'checkbox', 'url'].includes(
      field.customType ?? '',
    ));

export function memberName(id: unknown, ctx: ListContext) {
  if (!id) return '';
  return ctx.members.find((m) => m.id === id)?.displayName ?? '历史成员';
}

// Plain display text for a field; used by cells, sorting, filtering and confirmations.
export function displayText(item: Item, field: FieldDef, ctx: ListContext): string {
  const value = fieldValue(item, field.key);
  if (value === null || value === undefined || value === '') return '';
  switch (field.type) {
    case 'select':
      return (field.options as Record<string, string>)[String(value)] ?? String(value);
    case 'member':
      return memberName(value, ctx);
    case 'rich':
      return richText(String(value));
    case 'percent':
      return value + '%';
    case 'tags':
      return (value as string[])
        .map((id) => ctx.tags.find((t) => t.id === id)?.name)
        .filter(Boolean)
        .join('、');
    case 'objects':
      return (value as SapObject[]).map((o) => `${o.objectType} ${o.objectName}`).join('、');
    case 'custom': {
      const options = (field.options ?? []) as { id: string; label: string }[];
      if (field.customType === 'select') return options.find((o) => o.id === value)?.label ?? '';
      if (field.customType === 'multi_select')
        return (value as string[])
          .map((id) => options.find((o) => o.id === id)?.label)
          .filter(Boolean)
          .join('、');
      if (field.customType === 'member') return memberName(value, ctx);
      if (field.customType === 'checkbox') return value ? '是' : '否';
      return String(value);
    }
    default:
      return String(value);
  }
}

// Sort key: raw values for numbers and dates, display text otherwise.
export function sortValue(item: Item, field: FieldDef, ctx: ListContext): string | number {
  const value = fieldValue(item, field.key);
  if (field.key === 'code') return item.itemNo;
  if (['percent', 'effort'].includes(field.type) || field.customType === 'number')
    return typeof value === 'number' ? value : -1;
  if (field.key === 'priority') return { high: 1, medium: 2, low: 3 }[String(value)] ?? 9;
  if (field.key === 'difficulty') return { hard: 1, medium: 2, easy: 3 }[String(value)] ?? 9;
  if (field.key.endsWith('.status')) return Object.keys(OPTIONS.status).indexOf(String(value));
  if (field.type === 'date' || field.customType === 'date') return String(value ?? '');
  return displayText(item, field, ctx);
}

export const today = () => {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
};

// Planned end passed while the phase is still open and nobody set 已延误: a reminder on the status
// cell, data is not changed. Both count as risk (docs/specs/development-overview.md 3).
export const overdue = (phase: Phase) => phaseRisk(phase, today()) === 'stale';

// Deep copy that also works on reactive proxies (structuredClone rejects them).
export const cloneItem = (item: Item): Item => JSON.parse(JSON.stringify(item));

export function emptyItem(): Item {
  const phase = (): Phase => ({
    assigneeId: null,
    effortDays: null,
    plannedStart: null,
    plannedEnd: null,
    actualStart: null,
    actualEnd: null,
    progress: 0,
    status: 'not_started',
    notes: '',
  });
  return {
    id: '',
    code: '',
    itemNo: 0,
    rowVersion: '',
    createdBy: '',
    createdAt: '',
    updatedAt: '',
    module: '',
    kind: 'report',
    name: '',
    businessFunction: '',
    priority: 'medium',
    difficulty: 'medium',
    changeType: 'new',
    registeredOn: today(),
    businessOwner: '',
    notes: '',
    transactionCode: '',
    phases: {
      fsd: phase(),
      development: phase(),
      consultant_test: phase(),
      user_test: phase(),
    },
    objects: [],
    tags: [],
    custom: {},
  };
}

// Writes one field value into a draft copy of an item (used by the drawer form).
export function setFieldValue(item: Item, key: string, value: unknown) {
  if (key.startsWith('custom.')) {
    item.custom = { ...item.custom, [key.slice(7)]: value };
    return;
  }
  const dot = key.indexOf('.');
  if (dot > 0) {
    const phase = key.slice(0, dot) as PhaseKey;
    const name = key.slice(dot + 1) as keyof Phase;
    item.phases[phase] = { ...item.phases[phase], [name]: value };
    if (name === 'status' && value === 'completed') item.phases[phase].progress = 100;
    return;
  }
  (item as unknown as Record<string, unknown>)[key] = value;
}

// Keys whose value differs between two item states (compared as JSON).
export function changedKeys(before: Item, after: Item, fields: FieldDef[]) {
  return fields
    .filter((f) => f.type !== 'readonly')
    .filter(
      (f) =>
        JSON.stringify(fieldValue(before, f.key) ?? null) !==
        JSON.stringify(fieldValue(after, f.key) ?? null),
    )
    .map((f) => f.key);
}
