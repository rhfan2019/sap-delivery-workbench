export function composerState(input: {
  busy?: boolean;
  stopping?: boolean;
  blocked?: boolean;
  loading?: boolean;
  text?: string;
  ready?: boolean;
}): { status: 'streaming' | 'ready'; canSend: boolean; canStop: boolean };
export function restoreDraft(current: string, submitted: string): string;
export function stepPresentation(status: string): { label: string; tone: string };
export function formatElapsed(ms: number): string;
export function waitHint(quietMs: number): string;
