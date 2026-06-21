import type { ScheduledTask } from '@apolla/contracts';
import { cronMatches, nextRun } from './cron';

export interface ScheduledTaskRepository {
  save(task: ScheduledTask): Promise<ScheduledTask>;
  get(id: string): Promise<ScheduledTask | undefined>;
  list(ownerId: string): Promise<ScheduledTask[]>;
  /** All enabled tasks across owners (the scheduler ticks over these). */
  listEnabled(): Promise<ScheduledTask[]>;
  delete(ownerId: string, id: string): Promise<void>;
}

export interface SchedulerDeps {
  repo: ScheduledTaskRepository;
  /** Fire a due task (e.g. start a background Job). */
  trigger: (task: ScheduledTask) => Promise<void> | void;
}

const minuteKey = (d: Date | string): string => new Date(d).toISOString().slice(0, 16);

/**
 * In-process cron scheduler (S5-T3). tick(now) fires every enabled task whose cron matches the
 * current minute (deduped so a task fires at most once per minute), updating last/next run.
 * The clock is passed in, so eval/tests are deterministic and offline.
 */
export class Scheduler {
  constructor(private readonly d: SchedulerDeps) {}

  async tick(now: Date): Promise<string[]> {
    const fired: string[] = [];
    for (const task of await this.d.repo.listEnabled()) {
      if (!cronMatches(task.cron, now)) continue;
      if (task.lastRunAt && minuteKey(task.lastRunAt) === minuteKey(now)) continue; // already fired this minute
      await this.d.trigger(task);
      task.lastRunAt = now.toISOString();
      task.nextRunAt = nextRun(task.cron, now)?.toISOString();
      await this.d.repo.save(task);
      fired.push(task.id);
    }
    return fired;
  }
}
