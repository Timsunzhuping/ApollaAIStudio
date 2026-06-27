import type { Job } from '@apolla/contracts';
import type { JobRepository } from './types';

export interface ReconcileOptions {
  /** Called for each job moved to a terminal state on startup (e.g. to notify the owner). */
  onInterrupted?: (job: Job) => Promise<void> | void;
}

/**
 * Startup reconciliation (S10-T6): the JobRunner is in-process, so any job still `queued`/`running`
 * after a restart is dead. Mark each as `interrupted` (a terminal state) so users never sit forever
 * on a phantom 'running' job; optionally notify. Returns the number reconciled.
 */
export async function reconcileJobs(repo: JobRepository, opts: ReconcileOptions = {}): Promise<number> {
  const stale = await repo.listNonTerminal();
  for (const job of stale) {
    const updated: Job = { ...job, status: 'interrupted', error: 'interrupted by a server restart' };
    await repo.save(updated);
    await opts.onInterrupted?.(updated);
  }
  return stale.length;
}
