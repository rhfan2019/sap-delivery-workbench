export interface SseFrame {
  event: string;
  data: string;
  id: string;
}
export function createSseParser(maxFrameChars?: number): {
  push(text: string): SseFrame[];
  finish(): void;
};
