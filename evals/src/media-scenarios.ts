import {
  MediaRouter,
  MediaOrchestrator,
  StubMediaAdapter,
  InMemoryObjectStore,
  InMemoryMediaRepository,
  InMemoryCostLedger,
  PricingBook,
  RuleModerator,
  type MediaAdapter,
} from '@apolla/harness-core';
import type { MediaAlias, MediaRouteConfig, MediaJob } from '@apolla/contracts';
import type { CheckResult } from './checks';

const route = (alias: MediaAlias, primary: string): MediaRouteConfig => ({ alias, primary, fallbackChain: [], keyPool: [] });
const imageJob: MediaJob = { kind: 'image', prompt: 'a clean cover image of an EV', params: {} };

/** A provider that always fails — for the async-failure rollback scenario. */
class FailingMediaAdapter implements MediaAdapter {
  readonly provider = 'failing';
  capabilities() {
    return { kinds: ['video' as const], aspectRatios: [], referenceImage: false };
  }
  estimateCost() {
    return { usd: 0.2 };
  }
  async submit() {
    return { jobId: 'f1' };
  }
  async poll() {
    return { status: 'failed' as const, error: 'provider error' };
  }
  async fetchResult() {
    return [];
  }
}

async function drain(it: AsyncIterable<unknown>): Promise<void> {
  for await (const _e of it) void _e;
}

/** ① Provider contract: a stub-generated asset comes back well-formed (swap-safe). */
export async function mediaProviderContract(): Promise<CheckResult> {
  const router = new MediaRouter({ adapters: new Map([['stub', new StubMediaAdapter()]]), env: {}, routeFor: (a) => route(a, 'stub/x') });
  const r = await router.generate('image_premium', imageJob);
  const a = r.assets[0];
  const ok = r.status === 'ready' && !!a && a.kind === 'image' && a.uri.length > 0 && a.mime.length > 0;
  return { name: 'media-provider-contract', ok, issues: ok ? [] : ['stub provider did not return a well-formed asset'] };
}

/** ② Cost estimate accuracy: the metered media cost matches the pre-run estimate. */
export async function mediaCostAccuracy(): Promise<CheckResult> {
  const router = new MediaRouter({ adapters: new Map([['stub', new StubMediaAdapter()]]), env: {}, routeFor: (a) => route(a, 'stub/x') });
  const ledger = new InMemoryCostLedger(new PricingBook());
  const repo = new InMemoryMediaRepository();
  const orch = new MediaOrchestrator({ router, repo, store: new InMemoryObjectStore(), ledger, idGen: () => 'e1' });
  const estimate = router.estimateCost('image_premium', imageJob).usd;
  await drain(orch.run({ ownerId: 'u', alias: 'image_premium', job: imageJob, taskId: 'e1' }));
  const metered = ledger.totalUsd('e1');
  const ok = Math.abs(metered - estimate) < 1e-9;
  return { name: 'media-cost-accuracy', ok, issues: ok ? [] : [`estimate $${estimate} != metered $${metered}`] };
}

/** ③ Moderation interception: a disallowed prompt is blocked before any provider call. */
export async function mediaModeration(): Promise<CheckResult> {
  const router = new MediaRouter({ adapters: new Map([['stub', new StubMediaAdapter()]]), env: {}, routeFor: (a) => route(a, 'stub/x') });
  const repo = new InMemoryMediaRepository();
  const orch = new MediaOrchestrator({ router, repo, store: new InMemoryObjectStore(), moderator: new RuleModerator(), idGen: () => 'e2' });
  const events: { type: string }[] = [];
  for await (const e of orch.run({ ownerId: 'u', alias: 'image_fast', job: { kind: 'image', prompt: 'nsfw cover', params: {} }, taskId: 'e2' })) {
    events.push(e);
  }
  const blocked = events.some((e) => e.type === 'blocked') && !events.some((e) => e.type === 'asset');
  const failed = (await repo.get('e2'))?.status === 'failed';
  const ok = blocked && failed;
  return { name: 'media-moderation', ok, issues: ok ? [] : ['disallowed prompt was not blocked'] };
}

/** ④ Async failure rollback: a failing provider yields a failed task with no assets/dirty data. */
export async function mediaAsyncFailure(): Promise<CheckResult> {
  const router = new MediaRouter({ adapters: new Map([['failing', new FailingMediaAdapter()]]), env: {}, routeFor: (a) => route(a, 'failing/x') });
  const repo = new InMemoryMediaRepository();
  const orch = new MediaOrchestrator({ router, repo, store: new InMemoryObjectStore(), idGen: () => 'e3' });
  let lastType = '';
  for await (const e of orch.run({ ownerId: 'u', alias: 'video_premium', job: { kind: 'video', prompt: 'x', params: {} }, taskId: 'e3' })) lastType = e.type;
  const task = await repo.get('e3');
  const ok = lastType === 'error' && task?.status === 'failed' && (task?.assets.length ?? 0) === 0;
  return { name: 'media-async-failure', ok, issues: ok ? [] : ['failing provider did not roll back cleanly'] };
}

export async function runMediaScenarios(): Promise<CheckResult[]> {
  return Promise.all([mediaProviderContract(), mediaCostAccuracy(), mediaModeration(), mediaAsyncFailure()]);
}
