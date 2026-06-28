import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { verifyPassword, parseApiToken, type SessionRepository, type ApiTokenRepository } from '@apolla/harness-core';

const SECRET = process.env.SESSION_SECRET ?? 'dev-insecure-secret-change-me';
const COOKIE = 'apolla_session';
const TTL_MS = Number(process.env.SESSION_TTL_MS ?? 1000 * 60 * 60 * 24 * 30); // 30d
const IS_PROD = process.env.NODE_ENV === 'production';

/** Sign a session id so a tampered cookie is rejected (the id itself is also a random secret). */
function sign(sessionId: string): string {
  const mac = createHmac('sha256', SECRET).update(sessionId).digest('base64url');
  return `${Buffer.from(sessionId).toString('base64url')}.${mac}`;
}

function unsign(token: string | undefined): string | null {
  if (!token) return null;
  const [idPart, mac] = token.split('.');
  if (!idPart || !mac) return null;
  const sessionId = Buffer.from(idPart, 'base64url').toString('utf8');
  const expected = createHmac('sha256', SECRET).update(sessionId).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return sessionId;
}

function cookieValue(req: IncomingMessage): string | undefined {
  const token = (req.headers.cookie ?? '')
    .split(';')
    .map((c) => c.trim().split('='))
    .find(([k]) => k === COOKIE)?.[1];
  return token ? decodeURIComponent(token) : undefined;
}

/** Resolve the current owner from a valid, unexpired session — or null (fail-closed). */
export async function readSession(req: IncomingMessage, sessions: SessionRepository): Promise<string | null> {
  const id = unsign(cookieValue(req));
  if (!id) return null;
  const session = await sessions.get(id);
  return session?.ownerId ?? null;
}

/** Resolve the owner from an `Authorization: Bearer apolla_…` API token (cross-origin clients). */
export async function readBearer(req: IncomingMessage, tokens: ApiTokenRepository): Promise<string | null> {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return null;
  const parsed = parseApiToken(h.slice('Bearer '.length));
  if (!parsed) return null;
  const tok = await tokens.get(parsed.id);
  if (!tok || !verifyPassword(parsed.secret, tok.hashedToken)) return null;
  void Promise.resolve(tokens.touch(parsed.id, new Date().toISOString())).catch(() => {});
  return tok.ownerId;
}

/** Create a server-side session for `ownerId` and set the signed httpOnly cookie. */
export async function startSession(res: ServerResponse, sessions: SessionRepository, ownerId: string): Promise<void> {
  const id = randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + TTL_MS).toISOString();
  await sessions.create({ id, ownerId, expiresAt });
  const flags = ['HttpOnly', 'Path=/', 'SameSite=Lax', `Max-Age=${Math.floor(TTL_MS / 1000)}`];
  if (IS_PROD) flags.push('Secure');
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(sign(id))}; ${flags.join('; ')}`);
}

const MFA_PENDING_TTL_MS = 5 * 60 * 1000;
/**
 * A short-lived signed credential issued after the first factor (password) when MFA is enabled, and
 * exchanged at /api/auth/mfa/login for a full session (S20). Domain-separated from sessions and
 * magic-links ('mfa:' prefix + distinct payload) so it can NEVER be used as either — that separation
 * is what keeps step-up fail-closed.
 */
export function mfaPendingToken(userId: string): string {
  const payload = Buffer.from(JSON.stringify({ p: 'mfa', userId, exp: Date.now() + MFA_PENDING_TTL_MS })).toString('base64url');
  const mac = createHmac('sha256', SECRET).update(`mfa:${payload}`).digest('base64url');
  return `${payload}.${mac}`;
}
export function verifyMfaPending(token: string | undefined): string | null {
  if (!token) return null;
  const [payload, mac] = token.split('.');
  if (!payload || !mac) return null;
  const expected = createHmac('sha256', SECRET).update(`mfa:${payload}`).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const d = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { p?: string; userId?: string; exp?: number };
    if (d.p !== 'mfa' || !d.userId || !d.exp || d.exp <= Date.now()) return null;
    return d.userId;
  } catch {
    return null;
  }
}

/** Invalidate the current session server-side and clear the cookie. */
export async function endSession(req: IncomingMessage, res: ServerResponse, sessions: SessionRepository): Promise<void> {
  const id = unsign(cookieValue(req));
  if (id) await sessions.delete(id);
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
}
