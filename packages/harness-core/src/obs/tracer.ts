import { randomBytes, createHash } from 'node:crypto';

/**
 * Minimal OTel-shaped tracing surface (ARCHITECTURE §3.11, S17). Swappable: NoopTracer (default,
 * zero-overhead/offline), InMemoryTracer (deterministic tests), or an OpenTelemetry-backed tracer
 * (@apolla/otel) — call sites never change. Supports child spans + W3C traceparent inject/extract
 * for cross-process propagation (web → queue → worker).
 */
export interface SpanContext {
  traceId: string;
  spanId: string;
}

export interface StartSpanOptions {
  attributes?: Record<string, unknown>;
  /** Parent span context (explicit nesting or a remote parent from extract()). */
  parent?: SpanContext;
}

export interface Span {
  setAttributes(attrs: Record<string, unknown>): void;
  addEvent(name: string, attrs?: Record<string, unknown>): void;
  setStatus(status: 'ok' | 'error', message?: string): void;
  spanContext(): SpanContext;
  end(attrs?: Record<string, unknown>): void;
}

export interface Tracer {
  startSpan(name: string, opts?: StartSpanOptions): Span;
  /** Parse a W3C traceparent into a parent context. UNTRUSTED: correlation only, never authz. */
  extract(traceparent: string | undefined): SpanContext | undefined;
  /** W3C traceparent for a span (cross-process propagation), or undefined when not tracing. */
  inject(span: Span): string | undefined;
  shutdown(): Promise<void>;
}

const ZERO: SpanContext = { traceId: '0'.repeat(32), spanId: '0'.repeat(16) };
const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/;

export function parseTraceparent(tp: string | undefined): SpanContext | undefined {
  if (!tp) return undefined;
  const m = TRACEPARENT.exec(tp.trim());
  if (!m || m[1] === ZERO.traceId) return undefined;
  return { traceId: m[1]!, spanId: m[2]! };
}
export function formatTraceparent(ctx: SpanContext): string {
  return `00-${ctx.traceId}-${ctx.spanId}-01`;
}

// Credential-ish keys to drop. NOTE: matches auth tokens (token/accessToken/...) but NOT the LLM
// token *count* attributes (tokens/promptTokens/totalTokens), which are safe + useful.
const SENSITIVE = /secret|password|authorization|cookie|api[-_]?key|bearer|credential|^.*access[-_]?token|^.*refresh[-_]?token|^token$|^.*auth[-_]?token/i;
/**
 * Redact span attributes (S17 iron-law: spans never carry secrets/PII). Drops sensitive keys and
 * replaces owner identifiers with a short stable hash. Reuses the S10 redaction discipline.
 */
export function redactAttributes(attrs: Record<string, unknown> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (SENSITIVE.test(k)) continue;
    if (/^owner(Id)?$|^userId$/i.test(k) && typeof v === 'string') {
      out[k] = `u_${createHash('sha256').update(v).digest('hex').slice(0, 12)}`;
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** No-op tracer (default). Zero overhead; no propagation. */
export class NoopTracer implements Tracer {
  startSpan(_name?: string, _opts?: StartSpanOptions): Span {
    return {
      setAttributes(_a: Record<string, unknown>) {},
      addEvent(_n: string, _a?: Record<string, unknown>) {},
      setStatus(_s: 'ok' | 'error', _m?: string) {},
      spanContext: () => ZERO,
      end(_a?: Record<string, unknown>) {},
    };
  }
  extract(tp: string | undefined): SpanContext | undefined {
    return parseTraceparent(tp);
  }
  inject(_span: Span): string | undefined {
    return undefined;
  }
  async shutdown(): Promise<void> {}
}

/** Console tracer for local dev: logs span name, duration, and attributes on end. */
export class ConsoleTracer implements Tracer {
  constructor(private readonly now: () => number = () => performance.now()) {}
  startSpan(name: string, opts: StartSpanOptions = {}): Span {
    const started = this.now();
    const now = this.now;
    const ctx: SpanContext = {
      traceId: opts.parent?.traceId ?? randomBytes(16).toString('hex'),
      spanId: randomBytes(8).toString('hex'),
    };
    const attributes = redactAttributes(opts.attributes);
    return {
      setAttributes(a: Record<string, unknown>) { Object.assign(attributes, redactAttributes(a)); },
      addEvent(_n: string, _a?: Record<string, unknown>) {},
      setStatus(_s: 'ok' | 'error', _m?: string) {},
      spanContext: () => ctx,
      end: (endAttrs: Record<string, unknown> = {}) => {
        const ms = Math.round(now() - started);
        console.log(`[trace] ${name} ${ms}ms`, { ...attributes, ...redactAttributes(endAttrs) });
      },
    };
  }
  extract(tp: string | undefined): SpanContext | undefined { return parseTraceparent(tp); }
  inject(span: Span): string | undefined { return formatTraceparent(span.spanContext()); }
  async shutdown(): Promise<void> {}
}

export interface RecordedSpan {
  name: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  attributes: Record<string, unknown>;
  events: { name: string; attributes: Record<string, unknown> }[];
  status: 'unset' | 'ok' | 'error';
  ended: boolean;
}

/** In-memory tracer for deterministic tests — records the span tree (parent links, attrs, status). */
export class InMemoryTracer implements Tracer {
  readonly recorded: RecordedSpan[] = [];

  startSpan(name: string, opts: StartSpanOptions = {}): Span {
    const rec: RecordedSpan = {
      name,
      traceId: opts.parent?.traceId ?? randomBytes(16).toString('hex'),
      spanId: randomBytes(8).toString('hex'),
      parentSpanId: opts.parent?.spanId,
      attributes: redactAttributes(opts.attributes),
      events: [],
      status: 'unset',
      ended: false,
    };
    this.recorded.push(rec);
    return {
      setAttributes: (a) => Object.assign(rec.attributes, redactAttributes(a)),
      addEvent: (n, a) => rec.events.push({ name: n, attributes: redactAttributes(a) }),
      setStatus: (s) => { rec.status = s; },
      spanContext: () => ({ traceId: rec.traceId, spanId: rec.spanId }),
      end: (endAttrs) => { Object.assign(rec.attributes, redactAttributes(endAttrs)); rec.ended = true; },
    };
  }
  extract(tp: string | undefined): SpanContext | undefined { return parseTraceparent(tp); }
  inject(span: Span): string | undefined {
    const c = span.spanContext();
    return c.traceId === ZERO.traceId ? undefined : formatTraceparent(c);
  }
  async shutdown(): Promise<void> {}
  /** Test helper: spans recorded so far. */
  spans(): RecordedSpan[] { return this.recorded; }
}
