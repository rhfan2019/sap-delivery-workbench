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
}
