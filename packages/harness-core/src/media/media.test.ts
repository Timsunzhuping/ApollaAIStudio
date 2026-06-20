import { describe, it, expect } from 'vitest';
import type { MediaAlias, MediaJob, MediaRouteConfig } from '@apolla/contracts';
import { MediaRouter } from './router';
import { StubMediaAdapter } from './stub';
import { InMemoryMediaRepository } from '../repo/memory';

const route = (alias: MediaAlias, primary: string, fallbackChain: string[] = []): MediaRouteConfig => ({
  alias,
  primary,
  fallbackChain,
  keyPool: [],
});

function router(routeFor: (a: MediaAlias) => MediaRouteConfig) {
  return new MediaRouter({ adapters: new Map([['stub', new StubMediaAdapter()]]), env: {}, routeFor });
}

const imageJob: MediaJob = { kind: 'image', prompt: 'an EV on a coastal road', params: {} };
const videoJob: MediaJob = { kind: 'video', prompt: 'an explainer about EVs', params: { duration: 5 } };

describe('MediaRouter', () => {
  it('resolves an alias and generates an image asset (submit→ready)', async () => {
    const r = router((a) => route(a, 'stub/image'));
    const result = await r.generate('image_premium', imageJob);
    expect(result.status).toBe('ready');
    expect(result.assets).toHaveLength(1);
    expect(result.assets[0]!.kind).toBe('image');
    expect(result.assets[0]!.uri.startsWith('data:image/svg+xml')).toBe(true);
  });

  it('generates a video asset with a poster', async () => {
    const r = router((a) => route(a, 'stub/video'));
    const result = await r.generate('video_premium', videoJob);
    expect(result.status).toBe('ready');
    expect(result.assets[0]!.kind).toBe('video');
    expect(result.assets[0]!.posterUri).toBeTruthy();
    expect(result.assets[0]!.durationSec).toBeGreaterThan(0);
  });

  it('estimates cost and exposes capabilities by alias', () => {
    const r = router((a) => route(a, 'stub/image'));
    expect(r.estimateCost('image_fast', imageJob).usd).toBeGreaterThan(0);
    expect(r.estimateCost('video_premium', videoJob).usd).toBeGreaterThan(r.estimateCost('image_fast', imageJob).usd);
    expect(r.capabilities('image_fast').kinds).toContain('image');
  });

  it('fails over to the next candidate when the primary provider is unregistered', async () => {
    const r = router((a) => route(a, 'missing/x', ['stub/video']));
    const result = await r.generate('video_premium', videoJob);
    expect(result.status).toBe('ready');
    expect(result.provider).toBe('stub');
  });

  it('throws when no candidate adapter is registered', async () => {
    const r = router((a) => route(a, 'missing/x'));
    await expect(r.generate('image_fast', imageJob)).rejects.toThrow();
  });
});

describe('InMemoryMediaRepository', () => {
  it('persists and isolates media tasks by owner', async () => {
    const repo = new InMemoryMediaRepository();
    await repo.create({ id: 'm1', ownerId: 'u1', alias: 'image_fast', job: imageJob, status: 'ready', assets: [], costUsd: 0.01, moderated: true });
    await repo.create({ id: 'm2', ownerId: 'u2', alias: 'video_premium', job: videoJob, status: 'ready', assets: [], costUsd: 0.2, moderated: true });
    expect((await repo.get('m1'))?.alias).toBe('image_fast');
    expect((await repo.list('u1')).map((t) => t.id)).toEqual(['m1']);
  });
});
