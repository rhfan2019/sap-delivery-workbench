import { createSseParser } from '@sap-delivery-workbench/contracts/abap-fsd-agent/sse';

// Reconnect only the event subscription. A dropped connection never starts a model run.
export async function reconnectingChatStream(
  url,
  { signal, fetcher = fetch, after = 0, retryDelay = 500 } = {},
) {
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  let cursor = after,
    reader,
    response;
  const request = () =>
    fetcher(url + (url.includes('?') ? '&' : '?') + 'after=' + cursor, {
      credentials: 'same-origin',
      signal: controller.signal,
      headers: { Accept: 'text/event-stream' },
    });
  try {
    response = await request();
  } catch (error) {
    signal?.removeEventListener('abort', abort);
    throw error;
  }
  if (!response.ok) {
    signal?.removeEventListener('abort', abort);
    return response;
  }
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(output) {
      let terminal = false;
      try {
        while (!controller.signal.aborted && !terminal) {
          if (
            !response.headers.get('content-type')?.startsWith('text/event-stream') ||
            !response.body
          )
            throw Error('服务未返回文本事件流。');
          const parser = createSseParser(),
            decoder = new TextDecoder('utf-8', { fatal: true });
          reader = response.body.getReader();
          try {
            for (;;) {
              let chunk;
              try {
                chunk = await reader.read();
              } catch (error) {
                if (controller.signal.aborted) throw error;
                break;
              }
              if (chunk.done) break;
              for (const frame of parser.push(decoder.decode(chunk.value, { stream: true }))) {
                const event = JSON.parse(frame.data);
                if (!Number.isSafeInteger(event.seq)) throw Error('流事件游标无效。');
                if (event.seq <= cursor) continue;
                if (event.seq !== cursor + 1) throw Error('流事件不连续。');
                cursor = event.seq;
                output.enqueue(encoder.encode(`id: ${cursor}\ndata: ${JSON.stringify(event)}\n\n`));
                if (event.type === 'turn.end') {
                  terminal = true;
                  break;
                }
              }
              if (terminal) break;
            }
          } finally {
            await reader.cancel().catch(() => {});
            reader.releaseLock();
            reader = null;
          }
          if (terminal) break;
          // Discard a truncated frame; replay starts after the last complete one.
          for (;;) {
            controller.signal.throwIfAborted();
            await new Promise((resolve) => setTimeout(resolve, retryDelay));
            controller.signal.throwIfAborted();
            try {
              response = await request();
              break;
            } catch (error) {
              if (controller.signal.aborted) throw error;
            }
          }
          if (!response.ok) throw Error('流式连接恢复失败（' + response.status + '）。');
        }
        controller.signal.throwIfAborted();
        output.close();
      } catch (error) {
        output.error(error);
      } finally {
        signal?.removeEventListener('abort', abort);
      }
    },
    cancel() {
      controller.abort();
      void reader?.cancel().catch(() => {});
      signal?.removeEventListener('abort', abort);
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
}
