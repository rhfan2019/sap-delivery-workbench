import type { ColumnPreference } from '@sap-delivery-workbench/contracts/list-report/views';

export type { ColumnPreference };
export interface WorkbenchColumn {
  key: string;
  label: string;
  width?: number;
  minWidth?: number;
  visible?: boolean;
  fixed?: 'left' | 'right';
  required?: boolean;
  sortable?: boolean;
  hideBelow?: number;
  flex?: boolean;
  /** Visual group shown as a coloured stripe on the header. */
  group?: string;
}
