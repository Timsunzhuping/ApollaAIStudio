export interface Plan {
  name: string;
  /** Max lifetime tasks (Sprint 02 quota; refine to per-period later). */
  taskLimit: number;
}

export const PLANS: Record<string, Plan> = {
  free: { name: 'free', taskLimit: 50 },
  pro: { name: 'pro', taskLimit: 100_000 },
};

export interface QuotaStatus {
  ok: boolean;
  used: number;
  limit: number;
  plan: string;
}

/** Per-user task quota (PRD §6.8). Counts persisted tasks; enforced before creating a new one. */
export class Quota {
  constructor(
    private readonly countTasks: (ownerId: string) => Promise<number>,
    private readonly planOf: (ownerId: string) => Plan = () => PLANS.free!,
  ) {}

  async check(ownerId: string): Promise<QuotaStatus> {
    const plan = this.planOf(ownerId);
    const used = await this.countTasks(ownerId);
    return { ok: used < plan.taskLimit, used, limit: plan.taskLimit, plan: plan.name };
  }
}
