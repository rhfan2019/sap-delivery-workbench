export function composerState(input: {
  busy?: boolean;
  stopping?: boolean;
  blocked?: boolean;
  loading?: boolean;
  text?: string;
  modelId?: string;
}): { status: 'streaming' | 'ready'; canSend: boolean; canStop: boolean };
export function restoreDraft(current: string, submitted: string): string;
export function stepPresentation(status: string): { label: string; tone: string };
