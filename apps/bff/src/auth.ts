import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

const SECRET = process.env.SESSION_SECRET ?? 'dev-insecure-secret-change-me';
const COOKIE = 'apolla_session';

function sign(userId: string): string {
  const mac = createHmac('sha256', SECRET).update(userId).digest('base64url');
  return `${Buffer.from(userId).toString('base64url')}.${mac}`;
}

/** Verify a session token and return the userId, or null. */
export function verify(token: string | undefined): string | null {
  if (!token) return null;
  const [idPart, mac] = token.split('.');
  if (!idPart || !mac) return null;
  const userId = Buffer.from(idPart, 'base64url').toString('utf8');
  const expected = createHmac('sha256', SECRET).update(userId).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return userId;
}

export function readSession(req: IncomingMessage): string | null {
  const cookie = req.headers.cookie ?? '';
  const match = cookie.split(';').map((c) => c.trim().split('='));
  const token = match.find(([k]) => k === COOKIE)?.[1];
  return verify(token ? decodeURIComponent(token) : undefined);
}

export function setSession(res: ServerResponse, userId: string): void {
  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=${encodeURIComponent(sign(userId))}; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000`,
  );
}

export function clearSession(res: ServerResponse): void {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
}
