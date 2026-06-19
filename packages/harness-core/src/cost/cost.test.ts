import { describe, it, expect } from 'vitest';
import { PricingBook } from './pricing';
import { InMemoryCostLedger } from './ledger';
import { ModelRouter } from '../router/router';
import { MockAdapter } from '../router/mock';
import { NoopTracer, ConsoleTracer } from '../obs/tracer';
import type { ModelAlias, RouteConfig } from '@apolla/contracts';

describe('PricingBook', () => {
  it('prices known models and zero for unknown', () => {
    const book = new PricingBook().set('openai/x', { in: 1, out: 2 });
    expect(book.costOf('openai/x', 1000, 1000)).toBeCloseTo(3);
    expect(book.costOf('unknown/y', 1000, 1000)).toBe(0);
  });
});

describe('InMemoryCostLedger', () => {
  it('records, totals, and reports per-step cost', () => {
    const book = new PricingBook().set('openai/x', { in: 1, out: 2 });
    const ledger = new InMemoryCostLedger(book);
    ledger.recordLLM({ modelId: 'openai/x', tokensIn: 1000, tokensOut: 0 }, { taskId: 't1', stepId: 'plan' });
    ledger.recordLLM({ modelId: 'openai/x', tokensIn: 0, tokensOut: 1000 }, { taskId: 't1', stepId: 'generate' });

    expect(ledger.totalUsd('t1')).toBeCloseTo(3);
    expect(ledger.perStep('t1')).toEqual({ plan: 1, generate: 2 });
    expect(ledger.report('t1')).toContain('total $3.0000');
    expect(ledger.report('t1')).toContain('plan: $1.0000');
  });
});

describe('Router → Cost Ledger integration', () => {
  it('records usage automatically via onUsage with cost from the price book', async () => {
    const book = new PricingBook().set('mock/m1', { in: 1, out: 1 });
    const ledger = new InMemoryCostLedger(book);
    const route: RouteConfig = {
      alias: 'gpt_fast',
      primary: 'mock/m1',
      fallbackChain: [],
      keyPool: ['MOCK_KEY'],
    };
    const router = new ModelRouter({
      adapters: new Map([['mock', new MockAdapter('mock', { text: 'hi there' })]]),
      env: { MOCK_KEY: 'k1' },
      routeFor: () => route,
      onUsage: (e) => ledger.recordLLM(e, { taskId: 't1', stepId: 'search' }),
    });

    await router.completeText('gpt_fast' as ModelAlias, REQ);
    const records = ledger.all();
    expect(records).toHaveLength(1);
    expect(records[0]!.stepId).toBe('search');
    expect(records[0]!.costUsd).toBeGreaterThan(0);
  });
});

const REQ = { messages: [{ role: 'user' as const, content: 'hi' }] };

describe('Tracer', () => {
  it('Noop is a no-op; Console measures a span', () => {
    expect(() => new NoopTracer().startSpan('x').end()).not.toThrow();
    let t = 0;
    const tracer = new ConsoleTracer(() => (t += 5));
    const span = tracer.startSpan('step');
    expect(() => span.end({ ok: true })).not.toThrow();
  });
});
