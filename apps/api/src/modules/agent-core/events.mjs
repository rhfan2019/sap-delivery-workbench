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

// Streams one turn's events as SSE on a hijacked Fastify reply. `after` resumes after the
// last sequence the client saw. When the turn is not live in this process (finished, or
// interrupted by a restart), `storedTurn()` supplies the outcome to report instead.
export async function streamTurnEvents(reply, turnId, after, storedTurn) {
  reply.hijack();
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Content-Type-Options': 'nosniff',
  });
  // data carries the whole event so clients can resume by sequence.
  const send = (event) =>
    reply.raw.write(`id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  let keepAlive;
  const unsubscribe = subscribe(turnId, after, (event) => {
    if (event) return send(event);
    clearInterval(keepAlive);
    reply.raw.end();
  });
  if (!unsubscribe) {
    const turn = await storedTurn();
    send({
      seq: after + 1,
      type: 'turn.end',
      data: { status: turn?.status ?? 'interrupted', stopReason: turn?.stopReason },
    });
    reply.raw.end();
    return;
  }
  if (!reply.raw.writableEnded) {
    keepAlive = setInterval(() => reply.raw.write(': keep-alive\n\n'), 15000);
    keepAlive.unref();
  }
  reply.raw.on('close', () => {
    clearInterval(keepAlive);
    unsubscribe();
  });
}
