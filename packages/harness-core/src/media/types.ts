import type { MediaJob, MediaAsset, MediaCaps, MediaJobStatus, MediaTask, MediaRouteConfig } from '@apolla/contracts';

export type { MediaRouteConfig };

export interface MediaCost {
  usd: number;
}

export interface MediaCallOpts {
  apiKey?: string;
  signal?: AbortSignal;
}

export interface PollResult {
  status: MediaJobStatus;
  assets?: MediaAsset[];
  error?: string;
}

/**
 * A media provider adapter — the image/video parallel to the LLM adapter (PRD §13.2).
 * harness-core never imports concrete adapters; they are injected into the MediaRouter.
 * New provider (e.g. Seedance) = implement this + register an alias mapping. No business change.
 */
export interface MediaAdapter {
  readonly provider: string;
  submit(modelId: string, job: MediaJob, opts: MediaCallOpts): Promise<{ jobId: string }>;
  poll(jobId: string): Promise<PollResult>;
  fetchResult(jobId: string): Promise<MediaAsset[]>;
  capabilities(): MediaCaps;
  estimateCost(job: MediaJob): MediaCost;
}

/** Persistence boundary for media tasks (in-memory now; Postgres in S3-T4). */
export interface MediaRepository {
  create(task: MediaTask): Promise<MediaTask>;
  get(id: string): Promise<MediaTask | undefined>;
  save(task: MediaTask): Promise<void>;
  list(ownerId: string): Promise<MediaTask[]>;
}
