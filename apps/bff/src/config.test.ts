import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validateConfig } from './config';
import { DEV_SESSION_SECRET } from './auth';

describe('validateConfig (S24 release hardening)', () => {
  it('fails fast when an LLM key is set but routes still contain placeholders (first prod deploy finding)', () => {
    const saved = process.env.APOLLA_ROUTES_FILE;
    delete process.env.APOLLA_ROUTES_FILE; // repo default routes = placeholders
    try {
      const r = validateConfig({ OPENAI_API_KEY: 'k' });
      expect(r.errors.some((e) => e.includes('PLACEHOLDER') && e.includes('APOLLA_ROUTES_FILE'))).toBe(true);
      // no LLM key → stub mode → placeholders are fine
      expect(validateConfig({}).errors.some((e) => e.includes('PLACEHOLDER'))).toBe(false);
    } finally {
      if (saved !== undefined) process.env.APOLLA_ROUTES_FILE = saved;
    }
  });

  it('in production, fails fast on a missing or default SESSION_SECRET', () => {
    expect(validateConfig({ NODE_ENV: 'production', DATABASE_URL: 'postgres://x' }).errors.some((e) => e.includes('SESSION_SECRET'))).toBe(true);
    expect(validateConfig({ NODE_ENV: 'production', DATABASE_URL: 'postgres://x', SESSION_SECRET: DEV_SESSION_SECRET }).errors.some((e) => e.includes('SESSION_SECRET'))).toBe(true);
  });

  it('in production, requires a durable database', () => {
    expect(validateConfig({ NODE_ENV: 'production', SESSION_SECRET: 'strong-secret' }).errors.some((e) => e.includes('DATABASE_URL'))).toBe(true);
  });

  it('a fully-configured production env has no errors', () => {
    // Fully configured now includes real model routes (APOLLA_ROUTES_FILE), per the placeholder fail-fast.
    const dir = mkdtempSync(join(tmpdir(), 'apolla-routes-'));
    const file = join(dir, 'routes.json');
    writeFileSync(file, JSON.stringify({ routes: [
      { alias: 'gpt_fast', primary: 'openai/real-model', fallbackChain: [], keyPool: ['OPENAI_API_KEY'] },
      { alias: 'gpt_premium', primary: 'openai/real-model', fallbackChain: [], keyPool: ['OPENAI_API_KEY'] },
      { alias: 'claude_write', primary: 'openai/real-model', fallbackChain: [], keyPool: ['OPENAI_API_KEY'] },
      { alias: 'claude_premium', primary: 'openai/real-model', fallbackChain: [], keyPool: ['OPENAI_API_KEY'] },
    ] }));
    const saved = process.env.APOLLA_ROUTES_FILE;
    process.env.APOLLA_ROUTES_FILE = file;
    try {
      expect(validateConfig({ NODE_ENV: 'production', SESSION_SECRET: 'strong-secret', DATABASE_URL: 'postgres://x', OPENAI_API_KEY: 'k', ADMIN_EMAILS: 'a@x.ai', REDIS_URL: 'redis://x' }).errors).toHaveLength(0);
    } finally {
      if (saved === undefined) delete process.env.APOLLA_ROUTES_FILE; else process.env.APOLLA_ROUTES_FILE = saved;
    }
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
