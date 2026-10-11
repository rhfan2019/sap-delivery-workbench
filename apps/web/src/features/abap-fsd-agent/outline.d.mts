export interface OutlineItem {
  id: string;
  label: string;
  level: number;
  depth: number;
  parentId: string | null;
}
export function createOutline(
  headings: { level: number; text: string }[],
  prefix?: string,
): OutlineItem[];
export function visibleOutline(headings: OutlineItem[], collapsed: Set<string>): OutlineItem[];
