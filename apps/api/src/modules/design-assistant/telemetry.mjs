import { AsyncLocalStorage } from 'node:async_hooks';
import { isGraphInterrupt } from '@langchain/langgraph';
import { BasicTracerProvider, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { context, trace, SpanStatusCode } from '@opentelemetry/api';
import { safeError } from './policy.mjs';
import { resourceFromAttributes } from '@opentelemetry/resources';
const allowed = new Set([
  'task_id',
  'logical_run_id',
  'attempt_id',
  'thread_id',
  'node_id',
  'step_id',
  'operation_id',
  'checkpoint_id',
  'event_id',
  'error_code',
  'error_origin',
  'reason_code',
  'status',
  'before_revision',
  'after_revision',
  'duration_ms',
  'generation',
  'tokens',
  'usage_known',
  'graph_version',
  'prompt_hash',
  'input_snapshot_id',
  'read_generation',
  'remote_outcome',
  'attempt_no',
  'retry_reason',
  'cancel_source',
]);
export function safeAttributes(value = {}) {
  return Object.fromEntries(
    Object.entries(value).filter(
      ([key, v]) =>
        allowed.has(key) &&
        (typeof v === 'boolean' ||
          typeof v === 'number' ||
          (typeof v === 'string' && /^[a-zA-Z0-9_:./-]{1,160}$/.test(v))),
    ),
  );
}
export class BoundedExporter {
  constructor(exporter, { capacity = 1000, timeoutMs = 2000 } = {}) {
    this.exporter = exporter;
    this.capacity = capacity;
    this.timeoutMs = timeoutMs;
    this.queue = [];
    this.running = false;
    this.closed = false;
    this.metrics = { failed_total: 0, dropped_total: 0, exported_total: 0 };
  }
  get size() {
    return this.queue.length + (this.running ? 1 : 0);
  }
  export(spans, callback) {
    for (const span of spans) {
      if (this.closed || this.size >= this.capacity) this.metrics.dropped_total++;
      else this.queue.push(span);
    }
    callback({ code: 0 });
    void this.drain();
  }
  async drain() {
    if (this.running || this.closed) return;
    this.running = true;
    try {
      while (this.queue.length) {
        const span = this.queue.shift();
        let success = false;
        for (let i = 0; i < 2 && !success; i++) {
          success = await new Promise((resolve) => {
            const timer = setTimeout(() => resolve(false), this.timeoutMs);
            try {
              this.exporter.export([span], (result) => {
                clearTimeout(timer);
                resolve(result.code === 0);
              });
            } catch {
              clearTimeout(timer);
              resolve(false);
            }
          });
          if (!success) this.metrics.failed_total++;
        }
        if (success) this.metrics.exported_total++;
        else this.metrics.dropped_total++;
      }
    } finally {
      this.running = false;
    }
  }
  async shutdown() {
    this.closed = true;
    this.metrics.dropped_total += this.queue.length;
    this.queue = [];
    await Promise.race([
      this.exporter.shutdown(),
      new Promise((r) => setTimeout(r, this.timeoutMs)),
    ]);
  }
}
const local = new AsyncLocalStorage();
export function currentTrace() {
  const c = local.getStore()?.spanContext();
  return c ? { trace_id: c.traceId, span_id: c.spanId } : null;
}
export function createTelemetry({
  url = process.env.FSD_OTLP_URL,
  log = process.env.NODE_ENV !== 'test',
  spanExporter,
  exportOptions,
} = {}) {
  const exporter =
    spanExporter || url
      ? new BoundedExporter(
          spanExporter ?? new OTLPTraceExporter({ url, timeoutMillis: 2000 }),
          exportOptions,
        )
      : null;
  const provider = new BasicTracerProvider({
    resource: resourceFromAttributes({ 'service.name': 'abap-fsd', 'service.version': '1' }),
    spanProcessors: exporter ? [new SimpleSpanProcessor(exporter)] : [],
  });
  const tracer = provider.getTracer('abap-fsd', '1');
  const metrics = {};
  const count = (name, labels = {}) => {
    const error = safeError({ code: labels.error_code, error_origin: labels.error_origin });
    const safe = { error_code: error.code, error_origin: error.error_origin };
    const key = name + JSON.stringify(safe);
    metrics[key] = (metrics[key] ?? 0) + 1;
  };
  async function span(name, attributes, fn, links = []) {
    const parent = local.getStore();
    const ctx = parent ? trace.setSpan(context.active(), parent) : context.active();
    const sp = tracer.startSpan(name, { attributes: safeAttributes(attributes), links }, ctx),
      started = performance.now();
    const ids = sp.spanContext();
    const emit = (event, extra = {}) => {
      if (log)
        process.stdout.write(
          JSON.stringify({
            log_schema_version: 1,
            timestamp: new Date().toISOString(),
            level: event.endsWith('failed') ? 'ERROR' : 'INFO',
            service: 'abap-fsd',
            event_name: event,
            trace_id: ids.traceId,
            span_id: ids.spanId,
            redaction_policy_version: 'allowlist-1',
            ...safeAttributes(attributes),
            ...safeAttributes(extra),
          }) + '\n',
        );
    };
    emit(name + '.started');
    let failed = false,
      waiting = false;
    try {
      return await local.run(sp, () =>
        fn({
          trace_id: ids.traceId,
          span_id: ids.spanId,
          setAttributes: (value) => sp.setAttributes(safeAttributes(value)),
        }),
      );
    } catch (e) {
      if (name === 'graph.node.N10' && isGraphInterrupt(e)) {
        waiting = true;
        sp.setAttribute('status', 'WAITING');
        emit(name + '.waiting', { status: 'WAITING' });
        throw e;
      }
      failed = true;
      const error = safeError(e);
      const safe = { error_code: error.code, error_origin: error.error_origin };
      if (name === 'tool.attempt' || name === 'result.page')
        safe.remote_outcome = error.remote_outcome ?? 'UNKNOWN';
      if (['USER_PAUSED', 'RUN_CANCELLED'].includes(error.code))
        safe.cancel_source = 'USER_COMMAND';
      else if (error.code === 'LEASE_LOST') safe.cancel_source = 'LEASE_REVOKED';
      sp.setAttributes(safeAttributes(safe));
      sp.setStatus({ code: SpanStatusCode.ERROR });
      count('operation_failures_total', safe);
      emit(name + '.failed', safe);
      throw e;
    } finally {
      sp.setAttribute('duration_ms', performance.now() - started);
      emit(name + '.ended', {
        status: waiting ? 'WAITING' : failed ? 'FAILED' : 'SUCCEEDED',
        duration_ms: Math.round(performance.now() - started),
      });
      sp.end();
    }
  }
  return {
    span,
    count,
    metrics: () => ({
      ...metrics,
      exporter: exporter?.metrics ?? { disabled: true },
      degraded:
        !exporter || exporter.metrics.failed_total > 0 || exporter.metrics.dropped_total > 0,
    }),
    shutdown: () => provider.shutdown(),
  };
}
