import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildHarness } from './harness';
import { StubSpeechProvider } from '@apolla/harness-core';

const saved: Record<string, string | undefined> = {};
const KEYS = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_BASE_URL'];

beforeEach(() => { for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; } });
afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

describe('single-provider real mode (OpenAI-compatible gateways)', () => {
  it('one key is enough for real mode', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    const h = await buildHarness();
    expect(h.mode).toBe('real');
    await h.close?.();
  });

  it('no keys stays demo', async () => {
    const h = await buildHarness();
    expect(h.mode).toBe('demo');
    await h.close?.();
  });

  it('a custom OPENAI_BASE_URL keeps speech on the stub (gateways lack /audio/*)', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.OPENAI_BASE_URL = 'https://gateway.example.com/v1';
    const h = await buildHarness();
    expect(h.speech).toBeInstanceOf(StubSpeechProvider);
    await h.close?.();
  });
});
