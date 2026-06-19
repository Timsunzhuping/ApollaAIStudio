import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import type { ModelAlias, RouteConfig } from '@apolla/contracts';
import { ModelRouter } from './router';
import { ModelRouterError } from './types';
import { MockAdapter } from './mock';

function route(over: Partial<RouteConfig> = {}): RouteConfig {
  return {
    alias: 'gpt_fast',
    primary: 'mock/m1',
    fallbackChain: ['other/m2'],
    keyPool: ['MOCK_KEY'],
    ...over,
  };
}

const ALIAS: ModelAlias = 'gpt_fast';
const REQ = { messages: [{ role: 'user' as const, content: 'hi' }] };

describe('ModelRouter.complete', () => {
  it('resolves an alias to the primary adapter and streams text', async () => {
    const mock = new MockAdapter('mock', { text: 'hello world' });
    const router = new ModelRouter({
      adapters: new Map([['mock', mock]]),
      env: { MOCK_KEY: 'k1' },
      routeFor: () => route(),
    });
    expect((await router.completeText(ALIAS, REQ)).trim()).toBe('hello world');
    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0]!.apiKey).toBe('k1');
  });

  it('fails over from primary to the fallback candidate', async () => {
    const primary = new MockAdapter('mock', { failFirst: 1, error: 'boom' });
    const fallback = new MockAdapter('other', { text: 'from fallback' });
    const router = new ModelRouter({
      adapters: new Map([
        ['mock', primary],
        ['other', fallback],
      ]),
      env: { MOCK_KEY: 'k1' },
      routeFor: () => route(),
    });
    expect((await router.completeText(ALIAS, REQ)).trim()).toBe('from fallback');
  });

  it('rotates across keys in the pool before moving on', async () => {
    const mock = new MockAdapter('mock', { text: 'ok', failFirst: 1, error: 'rate limit' });
    const router = new ModelRouter({
      adapters: new Map([['mock', mock]]),
      env: { K1: 'a', K2: 'b' },
      routeFor: () => route({ keyPool: ['K1', 'K2'] }),
    });
    await router.completeText(ALIAS, REQ);
    expect(mock.calls.map((c) => c.apiKey)).toEqual(['a', 'b']);
  });

  it('reports usage via onUsage', async () => {
    const onUsage = vi.fn();
    const router = new ModelRouter({
      adapters: new Map([['mock', new MockAdapter('mock', { text: 'x' })]]),
      env: { MOCK_KEY: 'k1' },
      routeFor: () => route(),
      onUsage,
    });
    await router.completeText(ALIAS, REQ);
    expect(onUsage).toHaveBeenCalledOnce();
    expect(onUsage.mock.calls[0]![0]).toMatchObject({ alias: ALIAS, provider: 'mock', kind: 'llm' });
  });

  it('throws ModelRouterError with an attempt log when everything fails', async () => {
    const router = new ModelRouter({
      adapters: new Map([['mock', new MockAdapter('mock', { failFirst: 9, error: 'down' })]]),
      env: { MOCK_KEY: 'k1' },
      routeFor: () => route({ fallbackChain: [] }),
    });
    await expect(router.completeText(ALIAS, REQ)).rejects.toBeInstanceOf(ModelRouterError);
  });

  it('errors when no key is available for any candidate', async () => {
    const router = new ModelRouter({
      adapters: new Map([['mock', new MockAdapter('mock', { text: 'x' })]]),
      env: {},
      routeFor: () => route({ fallbackChain: [] }),
    });
    await expect(router.completeText(ALIAS, REQ)).rejects.toBeInstanceOf(ModelRouterError);
  });
});

describe('ModelRouter.json', () => {
  const schema = z.object({ answer: z.string() });

  it('returns a validated object', async () => {
    const mock = new MockAdapter('mock', { text: '{"answer":"42"}' });
    const router = new ModelRouter({
      adapters: new Map([['mock', mock]]),
      env: { MOCK_KEY: 'k1' },
      routeFor: () => route(),
    });
    expect(await router.json(ALIAS, REQ, schema)).toEqual({ answer: '42' });
  });

  it('retries with the validation error fed back, then succeeds', async () => {
    const mock = new MockAdapter('mock', {
      jsonSequence: ['{"wrong":true}', '{"answer":"ok"}'],
    });
    const router = new ModelRouter({
      adapters: new Map([['mock', mock]]),
      env: { MOCK_KEY: 'k1' },
      routeFor: () => route(),
    });
    expect(await router.json(ALIAS, REQ, schema)).toEqual({ answer: 'ok' });
    expect(mock.calls.length).toBe(2);
  });

  it('strips code fences before parsing', async () => {
    const mock = new MockAdapter('mock', { text: '```json\n{"answer":"fenced"}\n```' });
    const router = new ModelRouter({
      adapters: new Map([['mock', mock]]),
      env: { MOCK_KEY: 'k1' },
      routeFor: () => route(),
    });
    expect(await router.json(ALIAS, REQ, schema)).toEqual({ answer: 'fenced' });
  });

  it('throws after exhausting retries on persistently invalid output', async () => {
    const mock = new MockAdapter('mock', { jsonSequence: ['nope'] });
    const router = new ModelRouter({
      adapters: new Map([['mock', mock]]),
      env: { MOCK_KEY: 'k1' },
      routeFor: () => route({ fallbackChain: [] }),
      jsonMaxRetries: 1,
    });
    await expect(router.json(ALIAS, REQ, schema)).rejects.toBeInstanceOf(ModelRouterError);
    expect(mock.calls.length).toBe(2); // initial + 1 retry
  });
});
