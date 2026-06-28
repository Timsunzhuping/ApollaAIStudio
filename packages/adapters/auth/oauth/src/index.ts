import type { AuthProvider, OAuthTokens, ResolvedIdentity } from '@apolla/harness-core';

export interface OAuthProviderOptions {
  clientId?: string;
  clientSecret?: string;
  fetchFn?: typeof fetch;
}

/** Google OAuth 2.0 / OIDC provider (fetch-based, no SDK; env-gated). */
export class GoogleOAuthProvider implements AuthProvider {
  readonly name = 'google';
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly fetch: typeof fetch;
  constructor(opts: OAuthProviderOptions = {}) {
    this.clientId = opts.clientId ?? process.env.GOOGLE_CLIENT_ID ?? '';
    this.clientSecret = opts.clientSecret ?? process.env.GOOGLE_CLIENT_SECRET ?? '';
    this.fetch = opts.fetchFn ?? fetch;
  }
  authorizeUrl(input: { state: string; pkceChallenge: string; redirectUri: string }): string {
    const q = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: input.redirectUri,
      response_type: 'code',
      scope: 'openid email',
      state: input.state,
      code_challenge: input.pkceChallenge,
      code_challenge_method: 'S256',
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${q.toString()}`;
  }
  async exchangeCode(input: { code: string; pkceVerifier: string; redirectUri: string }): Promise<OAuthTokens> {
    const res = await this.fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: input.code,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: input.redirectUri,
        grant_type: 'authorization_code',
        code_verifier: input.pkceVerifier,
      }).toString(),
    });
    if (!res.ok) throw new Error(`Google token ${res.status}`);
    const json = (await res.json()) as { access_token?: string };
    return { accessToken: String(json.access_token ?? '') };
  }
  async fetchIdentity(tokens: OAuthTokens): Promise<ResolvedIdentity> {
    const res = await this.fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    });
    if (!res.ok) throw new Error(`Google userinfo ${res.status}`);
    const u = (await res.json()) as { sub?: string; email?: string; email_verified?: boolean };
    if (!u.sub || !u.email) throw new Error('Google userinfo missing sub/email');
    return { providerId: u.sub, email: u.email, emailVerified: u.email_verified === true };
  }
}

/** GitHub OAuth provider (fetch-based, no SDK; env-gated). Resolves the primary verified email. */
export class GitHubOAuthProvider implements AuthProvider {
  readonly name = 'github';
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly fetch: typeof fetch;
  constructor(opts: OAuthProviderOptions = {}) {
    this.clientId = opts.clientId ?? process.env.GITHUB_CLIENT_ID ?? '';
    this.clientSecret = opts.clientSecret ?? process.env.GITHUB_CLIENT_SECRET ?? '';
    this.fetch = opts.fetchFn ?? fetch;
  }
  authorizeUrl(input: { state: string; pkceChallenge: string; redirectUri: string }): string {
    const q = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: input.redirectUri,
      scope: 'read:user user:email',
      state: input.state,
    });
    return `https://github.com/login/oauth/authorize?${q.toString()}`;
  }
  async exchangeCode(input: { code: string; redirectUri: string }): Promise<OAuthTokens> {
    const res = await this.fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code: input.code,
        redirect_uri: input.redirectUri,
      }).toString(),
    });
    if (!res.ok) throw new Error(`GitHub token ${res.status}`);
    const json = (await res.json()) as { access_token?: string };
    return { accessToken: String(json.access_token ?? '') };
  }
  async fetchIdentity(tokens: OAuthTokens): Promise<ResolvedIdentity> {
    const headers = { authorization: `Bearer ${tokens.accessToken}`, accept: 'application/vnd.github+json' };
    const userRes = await this.fetch('https://api.github.com/user', { headers });
    if (!userRes.ok) throw new Error(`GitHub user ${userRes.status}`);
    const user = (await userRes.json()) as { id?: number; login?: string };
    const emailRes = await this.fetch('https://api.github.com/user/emails', { headers });
    if (!emailRes.ok) throw new Error(`GitHub emails ${emailRes.status}`);
    const emails = (await emailRes.json()) as { email: string; primary: boolean; verified: boolean }[];
    const primary = emails.find((e) => e.primary) ?? emails[0];
    if (!user.id || !primary) throw new Error('GitHub identity missing id/email');
    return { providerId: String(user.id), email: primary.email, emailVerified: primary.verified === true };
  }
}
