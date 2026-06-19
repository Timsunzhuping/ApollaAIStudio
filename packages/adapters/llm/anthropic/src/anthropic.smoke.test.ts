import { describe, it, expect } from 'vitest';
import { AnthropicAdapter } from './index';

/**
 * Real network smoke test — runs ONLY when ANTHROPIC_API_KEY and SMOKE_ANTHROPIC_MODEL are set.
 * Skipped in normal CI (no keys). Model id comes from env so no model name is hardcoded.
 */
const KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.SMOKE_ANTHROPIC_MODEL;

describe.skipIf(!KEY || !MODEL)('AnthropicAdapter (smoke)', () => {
  it('streams a short completion', async () => {
    const adapter = new AnthropicAdapter();
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
