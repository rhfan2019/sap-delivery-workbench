// In-process event buffer for live turns. A client that reconnects passes the last
// sequence it saw and receives the rest; finished turns are read back from the database.
const turns = new Map();
const KEEP_AFTER_END_MS = 5 * 60 * 1000;

export function openTurn(turnId) {
  const state = { events: [], listeners: new Set(), ended: false };
  turns.set(turnId, state);
  return (type, data = {}) => {
    if (state.ended) return;
    const event = { seq: state.events.length + 1, type, data };
    state.events.push(event);
    for (const listener of state.listeners) listener(event);
    if (type === 'turn.end') {
      state.ended = true;
      for (const listener of state.listeners) listener(null);
      state.listeners.clear();
      setTimeout(() => turns.delete(turnId), KEEP_AFTER_END_MS).unref();
    }
  };
}

// Calls onEvent for buffered events after `after`, then live ones; onEvent(null) marks the end.
// Returns an unsubscribe function, or null when the turn is not live in this process.
export function subscribe(turnId, after, onEvent) {
  const state = turns.get(turnId);
  if (!state) return null;
  for (const event of state.events) if (event.seq > after) onEvent(event);
  if (state.ended) {
    onEvent(null);
    return () => {};
  }
  state.listeners.add(onEvent);
  return () => state.listeners.delete(onEvent);
}
