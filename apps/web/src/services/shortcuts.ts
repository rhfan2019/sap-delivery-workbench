import { onActivated, onBeforeUnmount, onDeactivated, onMounted } from 'vue';

// Keyboard shortcuts (DESIGN.md 1.5, 5): one listener for the app. A component registers keys
// such as "N", "?" or "Ctrl+K" while it is mounted. Plain keys never fire while the person types
// in a field; Ctrl / ⌘ combinations do. The latest registration of a key wins. A page kept in a
// tab behind the current one (docs/specs/workbench-tabs.md 4) lets go of its keys until it is back.
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
// Dialogs, menus and popovers handle their own keys (Esc closes them first).
function inOverlay(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return !!el?.closest?.(
    '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-reka-popper-content-wrapper]',
  );
}
function listen(event: KeyboardEvent) {
  if (event.defaultPrevented || event.isComposing || event.altKey) return;
  if (inOverlay(event.target) || document.querySelector('[role="dialog"][data-state="open"]'))
    return;
  const key = name(event);
  if (!key.startsWith('Ctrl+') && typing(event.target)) return;
  const list = handlers.get(key);
  if (!list?.length) return;
  event.preventDefault();
  list[list.length - 1](event);
}

export function useShortcut(key: string, handler: Handler) {
  const normal = key.length === 1 ? key.toUpperCase() : key;
  let on = false;
  function add() {
    if (on) return;
    on = true;
    if (!listening) {
      window.addEventListener('keydown', listen);
      listening = true;
    }
    handlers.set(normal, [...(handlers.get(normal) ?? []), handler]);
  }
  function remove() {
    if (!on) return;
    on = false;
    handlers.set(
      normal,
      (handlers.get(normal) ?? []).filter((h) => h !== handler),
    );
  }
  onMounted(add);
  onActivated(add);
  onDeactivated(remove);
  onBeforeUnmount(remove);
}
