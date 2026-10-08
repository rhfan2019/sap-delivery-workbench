export function abortable(operation, signal) {
  signal.throwIfAborted();
  let stop;
  const aborted = new Promise((_, reject) => {
    stop = () => reject(signal.reason);
    signal.addEventListener('abort', stop, { once: true });
  });
  return Promise.race([Promise.resolve().then(operation), aborted]).finally(() =>
    signal.removeEventListener('abort', stop),
  );
}
