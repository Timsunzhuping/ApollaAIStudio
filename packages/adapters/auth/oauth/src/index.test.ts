import { describe, it, expect, vi } from 'vitest';
import { GoogleOAuthProvider, GitHubOAuthProvider } from './index';

function jsonRes(payload: unknown, ok = true) {
  return { ok, status: ok ? 200 : 400, json: async () => payload } as Response;
}

describe('GoogleOAuthProvider', () => {
  it('builds an authorize URL with PKCE + maps userinfo → identity', async () => {
    const p = new GoogleOAuthProvider({ clientId: 'cid', clientSecret: 'sec', fetchFn: vi.fn() });
    const url = p.authorizeUrl({ state: 'st', pkceChallenge: 'ch', redirectUri: 'http://x/cb' });
    expect(url).toContain('accounts.google.com');
    expect(url).toContain('code_challenge=ch');
    expect(url).toContain('code_challenge_method=S256');

    const fetchFn = vi.fn(async (u: string) =>
      String(u).includes('userinfo')
        ? jsonRes({ sub: 'g-123', email: 'a@x.dev', email_verified: true })
        : jsonRes({ access_token: 'tok' }),
    ) as unknown as typeof fetch;
    const g = new GoogleOAuthProvider({ clientId: 'cid', clientSecret: 'sec', fetchFn });
    const tokens = await g.exchangeCode({ code: 'c', pkceVerifier: 'v', redirectUri: 'r' });
    expect(tokens.accessToken).toBe('tok');
    expect(await g.fetchIdentity(tokens)).toEqual({ providerId: 'g-123', email: 'a@x.dev', emailVerified: true });
  });
});

describe('GitHubOAuthProvider', () => {
  it('resolves the primary verified email', async () => {
    const fetchFn = vi.fn(async (u: string) => {
      const s = String(u);
      if (s.endsWith('/user')) return jsonRes({ id: 42, login: 'octo' });
      if (s.endsWith('/user/emails')) return jsonRes([
        { email: 'alt@x.dev', primary: false, verified: true },
        { email: 'octo@x.dev', primary: true, verified: true },
      ]);
      return jsonRes({ access_token: 'gho_x' });
    }) as unknown as typeof fetch;
    const gh = new GitHubOAuthProvider({ clientId: 'cid', clientSecret: 'sec', fetchFn });
    const tokens = await gh.exchangeCode({ code: 'c', pkceVerifier: 'v', redirectUri: 'r' });
    expect(await gh.fetchIdentity(tokens)).toEqual({ providerId: '42', email: 'octo@x.dev', emailVerified: true });
  });
});
