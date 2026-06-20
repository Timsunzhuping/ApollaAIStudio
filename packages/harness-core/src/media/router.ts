import type { MediaAlias, MediaJob, MediaAsset, MediaCaps, MediaJobStatus } from '@apolla/contracts';
import { getMediaRoute } from '@apolla/config';
import type { MediaAdapter, MediaRouteConfig, MediaCost, MediaCallOpts } from './types';

function parseModelId(id: string): { provider: string; model: string } {
  const i = id.indexOf('/');
  if (i <= 0 || i === id.length - 1) throw new Error(`Invalid media model id (expected "provider/model"): ${id}`);
  return { provider: id.slice(0, i), model: id.slice(i + 1) };
}

export interface MediaRouterDeps {
  adapters: Map<string, MediaAdapter>;
  env?: NodeJS.ProcessEnv;
  routeFor?: (alias: MediaAlias) => MediaRouteConfig;
}

export interface MediaGenerateResult {
  status: MediaJobStatus;
  assets: MediaAsset[];
  cost: MediaCost;
  provider: string;
  modelId: string;
  jobId: string;
  error?: string;
}

const DEFAULT_KEY_ENV: Record<string, string[]> = {
  openai: ['OPENAI_API_KEY'],
  seedance: ['SEEDANCE_API_KEY'],
};

/**
 * Media Router (PRD §13.2) — the image/video parallel to the LLM Model Router. Business code calls
 * it with a logical alias only. Resolves alias→provider, estimates cost, submits, polls to terminal.
 * Full async lifecycle (long videos) is driven by the MediaOrchestrator (S3-T4); this also offers a
 * convenience generate() that submits + polls (the stub completes quickly).
 */
export class MediaRouter {
  private readonly adapters: Map<string, MediaAdapter>;
  private readonly env: NodeJS.ProcessEnv;
  private readonly routeFor: (alias: MediaAlias) => MediaRouteConfig;

  constructor(deps: MediaRouterDeps) {
    this.adapters = deps.adapters;
    this.env = deps.env ?? process.env;
    this.routeFor = deps.routeFor ?? getMediaRoute;
  }

  private candidates(alias: MediaAlias): string[] {
    const route = this.routeFor(alias);
    return [route.primary, ...route.fallbackChain];
  }

  private resolveKey(provider: string, route: MediaRouteConfig): string | undefined {
    const names = new Set<string>([...(DEFAULT_KEY_ENV[provider] ?? []), ...route.keyPool]);
    for (const n of names) {
      if (this.env[n]) return this.env[n];
    }
    return undefined;
  }

  /** First registered candidate adapter for the alias (for capabilities/estimate). */
  private primaryAdapter(alias: MediaAlias): { adapter: MediaAdapter; model: string } {
    for (const id of this.candidates(alias)) {
      const { provider, model } = parseModelId(id);
      const adapter = this.adapters.get(provider);
      if (adapter) return { adapter, model };
    }
    throw new Error(`No media adapter registered for alias "${alias}"`);
  }

  capabilities(alias: MediaAlias): MediaCaps {
    return this.primaryAdapter(alias).adapter.capabilities();
  }

  estimateCost(alias: MediaAlias, job: MediaJob): MediaCost {
    return this.primaryAdapter(alias).adapter.estimateCost(job);
  }

  /** Submit to the first working candidate; returns the handle to poll. */
  async submit(alias: MediaAlias, job: MediaJob): Promise<{ provider: string; modelId: string; jobId: string }> {
    const route = this.routeFor(alias);
    const attempts: string[] = [];
    for (const id of this.candidates(alias)) {
      const { provider, model } = parseModelId(id);
      const adapter = this.adapters.get(provider);
      if (!adapter) {
        attempts.push(`${id}: no adapter`);
        continue;
      }
      const opts: MediaCallOpts = { apiKey: this.resolveKey(provider, route) };
      try {
        const { jobId } = await adapter.submit(model, job, opts);
        return { provider, modelId: model, jobId };
      } catch (e) {
        attempts.push(`${id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    throw new Error(`media submit failed for "${alias}" :: ${attempts.join(' -> ')}`);
  }

  poll(provider: string, jobId: string) {
    const adapter = this.adapters.get(provider);
    if (!adapter) throw new Error(`Unknown media provider: ${provider}`);
    return adapter.poll(jobId);
  }

  /** Convenience: submit then poll to a terminal state. Used by the stub path and S3-T1 tests. */
  async generate(alias: MediaAlias, job: MediaJob, maxPolls = 30): Promise<MediaGenerateResult> {
    const cost = this.estimateCost(alias, job);
    const { provider, modelId, jobId } = await this.submit(alias, job);
    let last = await this.poll(provider, jobId);
    for (let i = 0; i < maxPolls && (last.status === 'submitted' || last.status === 'processing'); i++) {
      last = await this.poll(provider, jobId);
    }
    return {
      status: last.status,
      assets: last.assets ?? [],
      cost,
      provider,
      modelId,
      jobId,
      error: last.error,
    };
  }
}
