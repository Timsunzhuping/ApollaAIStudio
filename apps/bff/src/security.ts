import type { IncomingMessage, ServerResponse } from 'node:http';
import { RateLimiter } from '@apolla/harness-core';

export const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES ?? 1_000_000); // 1 MB

const num = (v: string | undefined, d: number): number => (v ? Number(v) : d);

// Per-IP limiter is loose (protects login/register + overall); per-owner is strict on expensive
// (LLM/media) endpoints. Defaults are generous so normal use never trips; tune via env in prod.
let ipLimiter = new RateLimiter({ ratePerSec: num(process.env.RATE_IP_RPS, 50), burst: num(process.env.RATE_IP_BURST, 100) });
let ownerLimiter = new RateLimiter({ ratePerSec: num(process.env.RATE_OWNER_RPS, 1), burst: num(process.env.RATE_OWNER_BURST, 20) });

/** Test hook: swap in deterministic limiters. */
export function setRateLimiters(ip: RateLimiter, owner: RateLimiter): void {
  ipLimiter = ip;
  ownerLimiter = owner;
}
export const limiters = {
  ip: () => ipLimiter,
  owner: () => ownerLimiter,
};

export function clientIp(req: IncomingMessage): string {
  const fwd = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim();
  return fwd || req.socket.remoteAddress || 'unknown';
}

/** Expensive endpoints (kick off LLM/media work) get the strict per-owner limit. */
export function isExpensive(method: string, pathname: string): boolean {
  if (method !== 'POST') return false;
  return (
    pathname === '/api/tasks' ||
    pathname === '/api/agent' ||
    pathname === '/api/cowork' ||
    pathname === '/api/media' ||
    pathname === '/api/surface' ||
    pathname === '/api/writer' ||
    pathname === '/api/skills/run' ||
    /^\/api\/tasks\/[^/]+\/media$/.test(pathname)
  );
}

export function applySecurityHeaders(res: ServerResponse): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  // Permissive enough for the inline demo UI (inline styles/scripts); the SPA is a separate origin.
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'",
  );
}

/**
 * CORS for a cross-origin SPA. Reads the allowlist from CORS_ORIGIN (comma-separated) per request.
 * Returns true if the request was a handled preflight (caller should stop). Same-origin (dev proxy)
 * needs no CORS — the allowlist is empty by default.
 */
export function applyCors(req: IncomingMessage, res: ServerResponse): boolean {
  const origin = req.headers.origin;
  const allow = (process.env.CORS_ORIGIN ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (origin && allow.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return true;
  }
  return false;
}
