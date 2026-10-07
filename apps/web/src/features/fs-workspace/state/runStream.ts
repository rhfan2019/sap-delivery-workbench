import type { RunEvent } from '../../../../../../packages/contracts/fs-workspace/generated/types';

const eventTypes = [
  'run.queued',
  'run.started',
  'run.progress',
  'run.waiting',
  'artifact.proposed',
  'draft.saved',
  'review.submitted',
  'approval.recorded',
  'baseline.published',
  'export.ready',
  'run.failed',
  'run.cancelled',
  'run.completed',
];
export function observeRun(
  base: string,
  runId: string,
  after: number,
  onEvent: (event: RunEvent) => void,
  onRecover: () => Promise<number | null>,
) {
  let source: EventSource | null = null,
    closed = false,
    recovering = false,
    cursor = after;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const recover = async () => {
    if (closed || recovering) return;
    recovering = true;
    source?.close();
    try {
      const next = await onRecover();
      if (next === null) {
        closed = true;
        return;
      }
      cursor = next;
    } finally {
      recovering = false;
      if (!closed) timer = setTimeout(connect, 1500);
    }
  };
  const connect = () => {
    if (closed) return;
    source = new EventSource(
      '/api' + base + '/runs/' + encodeURIComponent(runId) + '/events?after=' + cursor,
    );
    source.onerror = () => {
      void recover();
    };
    for (const type of eventTypes)
      source.addEventListener(type, (message) => {
        if (closed || recovering) return;
        let event: RunEvent;
        try {
          event = JSON.parse((message as MessageEvent).data);
        } catch {
          void recover();
          return;
        }
        if (event.context?.run_id !== runId || !Number.isSafeInteger(event.sequence)) {
          void recover();
          return;
        }
        if (event.sequence <= cursor) return;
        if (event.sequence !== cursor + 1) {
          void recover();
          return;
        }
        cursor = event.sequence;
        onEvent(event);
        if (['completed', 'cancelled', 'failed'].includes(event.run_status)) {
          closed = true;
          source?.close();
        }
      });
  };
  connect();
  return () => {
    closed = true;
    source?.close();
    clearTimeout(timer);
  };
}
