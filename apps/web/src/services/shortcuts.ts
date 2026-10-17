import { onBeforeUnmount, onMounted } from 'vue';

// Keyboard shortcuts (DESIGN.md 1.5, 5): one listener for the app. A component registers keys
// such as "N", "?" or "Ctrl+K" while it is mounted. Plain keys never fire while the person types
// in a field; Ctrl / ⌘ combinations do. The latest registration of a key wins.
type Handler = (event: KeyboardEvent) => void;
const handlers = new Map<string, Handler[]>();
let listening = false;

function name(event: KeyboardEvent) {
  const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
  return (event.ctrlKey || event.metaKey ? 'Ctrl+' : '') + key;
}
function typing(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return !!el?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
}
function listen(event: KeyboardEvent) {
  if (event.defaultPrevented || event.isComposing || event.altKey) return;
  const key = name(event);
  if (!key.startsWith('Ctrl+') && typing(event.target)) return;
  const list = handlers.get(key);
  if (!list?.length) return;
  event.preventDefault();
  list[list.length - 1](event);
}

export function useShortcut(key: string, handler: Handler) {
  const normal = key.length === 1 ? key.toUpperCase() : key;
  onMounted(() => {
    if (!listening) {
      window.addEventListener('keydown', listen);
      listening = true;
    }
    handlers.set(normal, [...(handlers.get(normal) ?? []), handler]);
  });
  onBeforeUnmount(() => {
    handlers.set(
      normal,
      (handlers.get(normal) ?? []).filter((h) => h !== handler),
    );
  });
}
