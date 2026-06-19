import { describe, it, expect } from 'vitest';
import type { LLMAdapter } from './types';
import { MockAdapter } from './mock';

/**
 * Provider contract: every LLMAdapter must satisfy these shape/behaviour guarantees.
 * Real adapters (OpenAI/Anthropic) run the same suite under their own *.contract.test.ts,
 * gated on API keys. This file always runs (MockAdapter) so `pnpm contract-test` has coverage.
 */
export function runAdapterContract(name: string, makeAdapter: () => LLMAdapter, modelId: string) {
  describe(`LLMAdapter contract: ${name}`, () => {
    const opts = { apiKey: 'test-key' };
    const req = { messages: [{ role: 'user' as const, content: 'ping' }] };

    it('exposes a provider name', () => {
      expect(typeof makeAdapter().provider).toBe('string');
    });

    it('stream() yields LLMChunks and resolves usage', async () => {
      const s = makeAdapter().stream(modelId, req, opts);
      let text = '';
      for await (const chunk of s.stream) {
        expect(typeof chunk.delta).toBe('string');
        text += chunk.delta;
      }
      const usage = await s.usage;
      expect(usage.tokensIn).toBeGreaterThanOrEqual(0);
      expect(usage.tokensOut).toBeGreaterThanOrEqual(0);
      expect(text.length).toBeGreaterThan(0);
    });

    it('json() returns text plus usage', async () => {
      const r = await makeAdapter().json(modelId, req, { type: 'object' }, opts);
      expect(typeof r.text).toBe('string');
      expect(r.usage).toBeTruthy();
    });
  });
}

runAdapterContract('MockAdapter', () => new MockAdapter('mock', { text: 'hello there' }), 'mock/m1');
