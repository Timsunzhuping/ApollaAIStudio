import { describe, it, expect } from 'vitest';
import { validateConfig } from './config';
import { DEV_SESSION_SECRET } from './auth';

describe('validateConfig (S24 release hardening)', () => {
  it('in production, fails fast on a missing or default SESSION_SECRET', () => {
    expect(validateConfig({ NODE_ENV: 'production', DATABASE_URL: 'postgres://x' }).errors.some((e) => e.includes('SESSION_SECRET'))).toBe(true);
    expect(validateConfig({ NODE_ENV: 'production', DATABASE_URL: 'postgres://x', SESSION_SECRET: DEV_SESSION_SECRET }).errors.some((e) => e.includes('SESSION_SECRET'))).toBe(true);
  });

  it('in production, requires a durable database', () => {
    expect(validateConfig({ NODE_ENV: 'production', SESSION_SECRET: 'strong-secret' }).errors.some((e) => e.includes('DATABASE_URL'))).toBe(true);
  });

  it('a fully-configured production env has no errors', () => {
    expect(validateConfig({ NODE_ENV: 'production', SESSION_SECRET: 'strong-secret', DATABASE_URL: 'postgres://x', OPENAI_API_KEY: 'k', ADMIN_EMAILS: 'a@x.ai', REDIS_URL: 'redis://x' }).errors).toHaveLength(0);
  });

  it('dev (no env) has zero errors — only warnings — so offline stays zero-config', () => {
    const r = validateConfig({});
    expect(r.errors).toHaveLength(0);
    expect(r.warnings.some((w) => w.includes('DATABASE_URL'))).toBe(true);
    expect(r.warnings.some((w) => w.includes('stub'))).toBe(true);
  });

  it('AUTH_MODE=password is treated as production', () => {
    expect(validateConfig({ AUTH_MODE: 'password' }).errors.some((e) => e.includes('SESSION_SECRET'))).toBe(true);
  });
});
