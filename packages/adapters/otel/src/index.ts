import {
  trace,
  context,
  SpanStatusCode,
  TraceFlags,
  type Span as OtelSpan,
  type Attributes,
} from '@opentelemetry/api';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { BatchSpanProcessor, ParentBasedSampler, TraceIdRatioBasedSampler } from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { redactAttributes, formatTraceparent, parseTraceparent, type Tracer, type Span, type SpanContext, type StartSpanOptions } from '@apolla/harness-core';

export interface OtelTracerOptions {
  endpoint?: string;
  serviceName?: string;
  /** Head sampling ratio (0..1). Defaults to 1 in dev / OTEL_TRACES_SAMPLER_ARG. */
  sampleRatio?: number;
}

// OTel attribute values are primitives/arrays; coerce unknowns + redact first.
function toAttributes(attrs: Record<string, unknown> = {}): Attributes {
  const out: Attributes = {};
  for (const [k, v] of Object.entries(redactAttributes(attrs))) {
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[k] = v;
    else if (v != null) out[k] = JSON.stringify(v);
  }
  return out;
}

/**
 * OpenTelemetry-backed Tracer (S17): exports spans over OTLP/HTTP, env-gated by
 * OTEL_EXPORTER_OTLP_ENDPOINT. Maps the harness Tracer/Span surface onto OTel, including remote
 * parent contexts (cross-process propagation) and W3C traceparent inject/extract.
 */
export class OtelTracer implements Tracer {
  private readonly provider: NodeTracerProvider;
  private readonly otel: ReturnType<typeof trace.getTracer>;

  constructor(opts: OtelTracerOptions = {}) {
    const endpoint = opts.endpoint ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? '';
    const serviceName = opts.serviceName ?? process.env.OTEL_SERVICE_NAME ?? 'apolla';
    const ratio = opts.sampleRatio ?? Number(process.env.OTEL_TRACES_SAMPLER_ARG ?? 1);
    this.provider = new NodeTracerProvider({
      resource: new Resource({ 'service.name': serviceName }),
      sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(ratio) }),
    });
    this.provider.addSpanProcessor(new BatchSpanProcessor(new OTLPTraceExporter({ url: `${endpoint.replace(/\/$/, '')}/v1/traces` })));
    this.provider.register();
    this.otel = trace.getTracer('apolla');
  }

  startSpan(name: string, opts: StartSpanOptions = {}): Span {
    let ctx = context.active();
    if (opts.parent) {
      ctx = trace.setSpanContext(ctx, {
        traceId: opts.parent.traceId,
        spanId: opts.parent.spanId,
        traceFlags: TraceFlags.SAMPLED,
        isRemote: true,
      });
    }
    const span: OtelSpan = this.otel.startSpan(name, { attributes: toAttributes(opts.attributes) }, ctx);
    return {
      setAttributes: (a) => span.setAttributes(toAttributes(a)),
      addEvent: (n, a) => span.addEvent(n, toAttributes(a)),
      setStatus: (s, m) => span.setStatus({ code: s === 'error' ? SpanStatusCode.ERROR : SpanStatusCode.OK, message: m }),
      spanContext: () => {
        const c = span.spanContext();
        return { traceId: c.traceId, spanId: c.spanId };
      },
      end: (endAttrs) => {
        if (endAttrs) span.setAttributes(toAttributes(endAttrs));
        span.end();
      },
    };
  }

  extract(traceparent: string | undefined): SpanContext | undefined {
    return parseTraceparent(traceparent);
  }
  inject(span: Span): string | undefined {
    const c = span.spanContext();
    return c.traceId === '0'.repeat(32) ? undefined : formatTraceparent(c);
  }
  async shutdown(): Promise<void> {
    await this.provider.shutdown().catch(() => {});
  }
}
