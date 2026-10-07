import { createSseParser } from '../../../packages/contracts/abap-fsd-agent/sse.mjs';
export function createClient({ url, origin = url, cookie }) {
  const headers = { cookie, origin, 'Content-Type': 'application/json' };
  return {
    async request(path, body, method = body === undefined ? 'GET' : 'POST') {
      const r = await fetch(url + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(120000),
      });
      const data = await r.json();
      if (!r.ok)
        throw Object.assign(Error(`${r.status}: ${data.message ?? '请求失败'}`), {
          status: r.status,
        });
      return data;
    },
    async stream(path, onEvent, { signal } = {}) {
      const r = await fetch(url + path, {
        headers: { ...headers, Accept: 'text/event-stream' },
        signal,
      });
      if (!r.ok) throw Object.assign(Error(`事件订阅失败 ${r.status}`), { status: r.status });
      const parser = createSseParser(),
        decoder = new TextDecoder();
      for await (const chunk of r.body) {
        for (const frame of parser.push(decoder.decode(chunk, { stream: true }))) {
          const e = JSON.parse(frame.data);
          await onEvent(e);
        }
      }
    },
  };
}
