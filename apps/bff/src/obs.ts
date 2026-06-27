import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Metrics } from '@apolla/harness-core';

export const metrics = new Metrics();

/** A response augmented with the resolved owner for logging (never includes secrets/PII). */
export type ObservedResponse = ServerResponse & { __ownerId?: string };

/**
 * Per-request observability (S10-T5): assign a request-id, time the request, record metrics, and
 * emit one redacted structured log line on finish. Cookies/passwords/tokens are never logged.
 */
export function observe(req: IncomingMessage, res: ObservedResponse): string {
  const reqId = randomUUID().slice(0, 8);
  res.setHeader('x-request-id', reqId);
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    metrics.observe(ms);
    metrics.inc('http.requests');
    metrics.inc(`http.status.${Math.floor(res.statusCode / 100)}xx`);
    if (!process.env.VITEST) {
      console.log(
        JSON.stringify({
          t: new Date().toISOString(),
          reqId,
          method: req.method,
          path: (req.url ?? '').split('?')[0],
          status: res.statusCode,
          ms,
          ownerId: res.__ownerId,
        }),
      );
    }
  });
  return reqId;
}
