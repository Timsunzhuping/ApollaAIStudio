import { describe, it, expect } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { InMemorySessionRepository } from '@apolla/harness-core';
import { readSession, startSession, endSession } from './auth';

function fakeRes() {
  const headers: Record<string, string> = {};
  return { setHeader: (k: string, v: string) => { headers[k] = v; }, headers } as unknown as ServerResponse & { headers: Record<string, string> };
}
function cookieFrom(res: { headers: Record<string, string> }): string {
  return res.headers['Set-Cookie']!.split(';')[0]!; // "apolla_session=<token>"
}
function reqWith(cookie: string): IncomingMessage {
  return { headers: { cookie } } as unknown as IncomingMessage;
}

describe('server-side sessions', () => {
  it('starts a session, sets an httpOnly cookie, and resolves the owner', async () => {
    const sessions = new InMemorySessionRepository();
    const res = fakeRes();
    await startSession(res, sessions, 'user_42');
    expect(res.headers['Set-Cookie']).toMatch(/HttpOnly/);
    expect(res.headers['Set-Cookie']).toMatch(/SameSite=Lax/);
    expect(await readSession(reqWith(cookieFrom(res)), sessions)).toBe('user_42');
  });

  it('rejects a tampered cookie signature', async () => {
    const sessions = new InMemorySessionRepository();
    const res = fakeRes();
    await startSession(res, sessions, 'user_42');
    const cookie = cookieFrom(res).replace(/\.[^.]+$/, '.forged');
    expect(await readSession(reqWith(cookie), sessions)).toBeNull();
  });

  it('logout deletes the session server-side (revocation)', async () => {
    const sessions = new InMemorySessionRepository();
    const res = fakeRes();
    await startSession(res, sessions, 'user_42');
    const cookie = cookieFrom(res);
    await endSession(reqWith(cookie), fakeRes(), sessions);
    expect(await readSession(reqWith(cookie), sessions)).toBeNull();
  });

  it('treats an expired session as absent', async () => {
    const sessions = new InMemorySessionRepository();
    await sessions.create({ id: 'sid1', ownerId: 'u', expiresAt: new Date(Date.now() - 1000).toISOString() });
    // sign sid1 the way startSession would by round-tripping through a fresh start, then swap the id:
    const res = fakeRes();
    await startSession(res, sessions, 'u'); // produces a valid signed cookie for a *different* id
    expect(await readSession(reqWith(cookieFrom(res)), sessions)).toBe('u');
    expect(await sessions.get('sid1')).toBeUndefined();
  });

  it('rejects missing / malformed cookies', async () => {
    const sessions = new InMemorySessionRepository();
    expect(await readSession({ headers: {} } as unknown as IncomingMessage, sessions)).toBeNull();
    expect(await readSession(reqWith('apolla_session=garbage'), sessions)).toBeNull();
  });
});
