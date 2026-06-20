import { randomUUID } from 'node:crypto';
import type { MediaAlias, MediaJob, MediaTask, MediaAsset, MediaJobStatus } from '@apolla/contracts';
import type { MediaRouter } from './router';
import type { MediaRepository } from './types';
import { rehostAsset, type ObjectStore } from './store';
import type { InMemoryCostLedger } from '../cost/ledger';

export interface MediaRunInput {
  ownerId: string;
  alias: MediaAlias;
  job: MediaJob;
  taskId?: string;
  projectId?: string;
}

export type MediaEvent =
  | { type: 'submitted'; taskId: string; estimateUsd: number }
  | { type: 'progress'; status: MediaJobStatus }
  | { type: 'asset'; assets: MediaAsset[] }
  | { type: 'cost'; usd: number }
  | { type: 'done'; taskId: string }
  | { type: 'error'; message: string };

export interface MediaOrchestratorDeps {
  router: MediaRouter;
  repo: MediaRepository;
  store: ObjectStore;
  ledger?: InMemoryCostLedger;
  idGen?: () => string;
  pollIntervalMs?: number;
  maxPolls?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Async media task orchestrator (PRD §13, S3-T4). Drives submitted→processing→ready|failed,
 * emits a progress event stream, re-hosts produced assets into our object store, meters cost,
 * and persists an owner-scoped, replayable MediaTask.
 */
export class MediaOrchestrator {
  private readonly d: MediaOrchestratorDeps;
  private readonly idGen: () => string;
  private readonly pollIntervalMs: number;
  private readonly maxPolls: number;

  constructor(deps: MediaOrchestratorDeps) {
    this.d = deps;
    this.idGen = deps.idGen ?? (() => randomUUID());
    this.pollIntervalMs = deps.pollIntervalMs ?? 0;
    this.maxPolls = deps.maxPolls ?? 120;
  }

  async *run(input: MediaRunInput): AsyncIterable<MediaEvent> {
    const taskId = input.taskId ?? this.idGen();
    const task: MediaTask = {
      id: taskId,
      ownerId: input.ownerId,
      alias: input.alias,
      job: input.job,
      status: 'submitted',
      assets: [],
      costUsd: 0,
      moderated: false,
      projectId: input.projectId,
    };

    try {
      const estimate = this.d.router.estimateCost(input.alias, input.job);
      await this.d.repo.create(task);
      yield { type: 'submitted', taskId, estimateUsd: estimate.usd };

      const { provider, jobId } = await this.d.router.submit(input.alias, input.job);
      task.status = 'processing';
      await this.d.repo.save(task);
      yield { type: 'progress', status: 'processing' };

      let last = await this.d.router.poll(provider, jobId);
      for (let i = 0; i < this.maxPolls && (last.status === 'submitted' || last.status === 'processing'); i++) {
        if (this.pollIntervalMs) await sleep(this.pollIntervalMs);
        last = await this.d.router.poll(provider, jobId);
      }

      if (last.status === 'ready') {
        const assets = await Promise.all((last.assets ?? []).map((a) => rehostAsset(this.d.store, a)));
        task.assets = assets;
        task.status = 'ready';
        task.costUsd = estimate.usd;
        this.d.ledger?.record({
          kind: 'media',
          alias: input.alias,
          provider,
          tokensIn: 0,
          tokensOut: 0,
          costUsd: estimate.usd,
          cacheHit: false,
          taskId,
        });
        await this.d.repo.save(task);
        yield { type: 'asset', assets };
        yield { type: 'cost', usd: estimate.usd };
        yield { type: 'done', taskId };
      } else {
        task.status = 'failed';
        task.error = last.error;
        await this.d.repo.save(task);
        yield { type: 'error', message: last.error ?? 'generation failed' };
      }
    } catch (e) {
      task.status = 'failed';
      task.error = e instanceof Error ? e.message : String(e);
      await this.d.repo.save(task);
      yield { type: 'error', message: task.error };
    }
  }
}
