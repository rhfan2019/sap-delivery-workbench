import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
export const traceRoot =
  process.env.FSD_TRACE_DIR || fileURLToPath(new URL('../runs/telemetry/', import.meta.url));
const uuid = /^[a-f0-9-]{36}$/i;
export function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        /^(apiKey|password|token|cookie|authorization|secret_cipher|passwordCipher|secret|key)$/i.test(
          k,
        )
          ? '[REDACTED]'
          : redact(v),
      ]),
    );
  return value;
}
export function readTrace({ runId, root = traceRoot }) {
  if (!uuid.test(runId)) return [];
  try {
    return readFileSync(join(root, runId + '.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line, index) => {
        try {
          return JSON.parse(line);
        } catch {
          return {
            version: 1,
            runId,
            seq: index + 1,
            type: 'trace.corrupt',
            data: { line: index + 1, code: 'INCOMPLETE_OR_CORRUPT_RECORD' },
          };
        }
      });
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}
export function createRecorder({ runId, root = traceRoot }) {
  if (!uuid.test(runId)) throw new Error('Invalid trace run ID');
  let seq = 0,
    initialError;
  try {
    mkdirSync(root, { recursive: true });
    seq = readTrace({ runId, root }).at(-1)?.seq ?? 0;
  } catch (error) {
    initialError = error;
  }
  return {
    runId,
    write(type, data = {}) {
      if (initialError) throw initialError;
      appendFileSync(
        join(root, runId + '.jsonl'),
        JSON.stringify({
          version: 1,
          runId,
          seq: ++seq,
          at: new Date().toISOString(),
          type,
          data: redact(data),
        }) + '\n',
        { mode: 0o600 },
      );
    },
  };
}
