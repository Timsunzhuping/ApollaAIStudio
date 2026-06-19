import { describe, it, expect } from 'vitest';
import { OpenAIAdapter } from './index';

/**
 * Real network smoke test — runs ONLY when OPENAI_API_KEY and SMOKE_OPENAI_MODEL are set.
 * Skipped in normal CI (no keys). Model id comes from env so no model name is hardcoded.
 */
const KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.SMOKE_OPENAI_MODEL;

describe.skipIf(!KEY || !MODEL)('OpenAIAdapter (smoke)', () => {
  it('streams a short completion', async () => {
    const adapter = new OpenAIAdapter();
    const s = adapter.stream(
      MODEL!,
      { messages: [{ role: 'user', content: 'Say "pong" and nothing else.' }] },
      { apiKey: KEY! },
    );
    let text = '';
    for await (const c of s.stream) text += c.delta;
    const usage = await s.usage;
    expect(text.toLowerCase()).toContain('pong');
    expect(usage.tokensOut).toBeGreaterThan(0);
  });
});
