import { describe, it, expect } from 'vitest';
import type { MediaAlias, MediaJob, MediaRouteConfig } from '@apolla/contracts';
import { MediaOrchestrator } from './orchestrator';
import { MediaRouter } from './router';
import { StubMediaAdapter } from './stub';
import { InMemoryObjectStore, rehostAsset } from './store';
import { InMemoryMediaRepository } from '../repo/memory';
import { InMemoryCostLedger } from '../cost/ledger';
import { PricingBook } from '../cost/pricing';
import type { MediaEvent } from './orchestrator';

const route = (alias: MediaAlias): MediaRouteConfig => ({ alias, primary: 'stub/x', fallbackChain: [], keyPool: [] });
const job: MediaJob = { kind: 'image', prompt: 'cover for an EV report', params: {} };

function build() {
  const router = new MediaRouter({ adapters: new Map([['stub', new StubMediaAdapter()]]), env: {}, routeFor: route });
  const repo = new InMemoryMediaRepository();
  const ledger = new InMemoryCostLedger(new PricingBook());
  let n = 0;
  const orch = new MediaOrchestrator({ router, repo, store: new InMemoryObjectStore(), ledger, idGen: () => `m${n++}` });
  return { orch, repo, ledger };
}

async function collect(it: AsyncIterable<MediaEvent>): Promise<MediaEvent[]> {
  const out: MediaEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

describe('MediaOrchestrator', () => {
  it('walks submitted→processing→ready, emitting estimate, asset and cost', async () => {
    const { orch, repo, ledger } = build();
    const events = await collect(orch.run({ ownerId: 'u1', alias: 'image_premium', job, taskId: 't1' }));
    const types = events.map((e) => e.type);
    expect(types[0]).toBe('submitted');
    expect(types).toContain('progress');
    expect(types).toContain('asset');
    expect(types.at(-1)).toBe('done');

    const submitted = events.find((e) => e.type === 'submitted') as { estimateUsd: number };
    expect(submitted.estimateUsd).toBeGreaterThan(0);

    const task = await repo.get('t1');
    expect(task?.status).toBe('ready');
    expect(task?.assets[0]?.kind).toBe('image');
    expect(task?.costUsd).toBeGreaterThan(0);

    // cost metered into the ledger as a media record
    expect(ledger.all().some((r) => r.kind === 'media')).toBe(true);
  });

  it('yields error and persists a failed task when no provider is available', async () => {
    const repo = new InMemoryMediaRepository();
    const orch = new MediaOrchestrator({
      router: new MediaRouter({ adapters: new Map(), env: {}, routeFor: route }),
      repo,
      store: new InMemoryObjectStore(),
      idGen: () => 'tF',
    });
    const events = await collect(orch.run({ ownerId: 'u', alias: 'image_fast', job, taskId: 'tF' }));
    expect(events.at(-1)?.type).toBe('error');
    expect((await repo.get('tF'))?.status).toBe('failed');
  });
});

describe('rehostAsset', () => {
  it('passes through self-contained URIs and re-hosts http URIs', async () => {
    const store = new InMemoryObjectStore('mem://');
    const dataAsset = await rehostAsset(store, { id: 'a', kind: 'image', mime: 'image/svg+xml', uri: 'data:image/svg+xml;utf8,<svg/>' });
    expect(dataAsset.uri.startsWith('data:')).toBe(true);

    const fakeFetch = async () => ({ arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer });
    const httpAsset = await rehostAsset(store, { id: 'b', kind: 'image', mime: 'image/png', uri: 'https://x/img.png' }, fakeFetch);
    expect(httpAsset.uri.startsWith('mem://')).toBe(true);
  });
});
