/**
 * Minimal OTel-shaped tracing surface (ARCHITECTURE §3.11). Swap in an OpenTelemetry-backed
 * implementation later without touching call sites.
 */
export interface Span {
  end(attrs?: Record<string, unknown>): void;
}

export interface Tracer {
  startSpan(name: string, attrs?: Record<string, unknown>): Span;
}

/** No-op tracer (default). */
export class NoopTracer implements Tracer {
  startSpan(_name?: string, _attrs?: Record<string, unknown>): Span {
    return { end() {} };
  }
}

/** Console tracer for local dev: logs span name, duration, and attributes on end. */
export class ConsoleTracer implements Tracer {
  constructor(private readonly now: () => number = () => performance.now()) {}

  startSpan(name: string, attrs: Record<string, unknown> = {}): Span {
    const started = this.now();
    const now = this.now;
    return {
      end: (endAttrs: Record<string, unknown> = {}) => {
        const ms = Math.round(now() - started);
        console.log(`[trace] ${name} ${ms}ms`, { ...attrs, ...endAttrs });
      },
    };
  }
}
