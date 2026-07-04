import type { ProductEvent } from '@apolla/contracts';

/**
 * North-star aggregation (S29, PRD §9): effective workflows per active user per week.
 *
 * Effective workflow — a task that:
 *   1. reached `task_delivered`;
 *   2. received any `artifact_adopted` action (export / save / share / skill / media / rerun);
 *   3. was never marked unusable via `feedback_given`.
 *
 * Pure functions over the event log — no counters to drift, replayable from history.
 */

export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
/** Adoption often happens the next morning — count it for the delivery week. */
const GRACE_MS = 48 * 60 * 60 * 1000;

export interface WeeklyNorthStar {
  weekStartIso: string;
  weekEndIso: string;
  /** ownerId → effective workflows delivered this week. */
  effectiveWorkflowsByOwner: Record<string, number>;
  activeUsers: number;
  /** The north star: effective workflows per active user. */
  perActiveUser: number;
  /** Share of active users at the ≥3/week target. */
  usersAtTarget: number;
  funnel: {
    submitted: number;
    delivered: number;
    adopted: number;
    completionRate: number;
    adoptionRate: number;
  };
  /** Registered this week who had a delivered+adopted task within 24h. */
  activation: { registered: number; activated: number; rate: number };
}

function ms(e: ProductEvent): number {
  return Date.parse(e.at);
}

/** taskId → owner for tasks satisfying all three effective-workflow conditions. */
export function effectiveWorkflows(events: ProductEvent[]): Map<string, string> {
  const delivered = new Map<string, string>();
  const adopted = new Set<string>();
  const unusable = new Set<string>();
  for (const e of events) {
    if (!e.taskId) continue;
    if (e.type === 'task_delivered') delivered.set(e.taskId, e.ownerId);
    else if (e.type === 'artifact_adopted') adopted.add(e.taskId);
    else if (e.type === 'feedback_given' && e.verdict === 'unusable') unusable.add(e.taskId);
  }
  const out = new Map<string, string>();
  for (const [taskId, ownerId] of delivered) {
    if (adopted.has(taskId) && !unusable.has(taskId)) out.set(taskId, ownerId);
  }
  return out;
}

export function weeklyNorthStar(allEvents: ProductEvent[], weekStart: Date): WeeklyNorthStar {
  const start = weekStart.getTime();
  const end = start + WEEK_MS;
  const inWeek = allEvents.filter((e) => ms(e) >= start && ms(e) < end);
  // Effectiveness judged with a post-week grace window; attribution stays with the delivery week.
  const judging = allEvents.filter((e) => ms(e) >= start && ms(e) < end + GRACE_MS);

  const deliveredThisWeek = new Set(
    inWeek.filter((e) => e.type === 'task_delivered' && e.taskId).map((e) => e.taskId!),
  );
  const effective = effectiveWorkflows(judging);
  const byOwner: Record<string, number> = {};
  for (const [taskId, ownerId] of effective) {
    if (!deliveredThisWeek.has(taskId)) continue;
    byOwner[ownerId] = (byOwner[ownerId] ?? 0) + 1;
  }
  const counts = Object.values(byOwner);
  const activeUsers = counts.length;
  const total = counts.reduce((a, b) => a + b, 0);

  const submitted = inWeek.filter((e) => e.type === 'task_submitted').length;
  const delivered = deliveredThisWeek.size;
  const adoptedTasks = new Set(
    judging.filter((e) => e.type === 'artifact_adopted' && e.taskId).map((e) => e.taskId!),
  );
  const adopted = [...deliveredThisWeek].filter((t) => adoptedTasks.has(t)).length;

  const registered = inWeek.filter((e) => e.type === 'user_registered');
  let activated = 0;
  for (const r of registered) {
    const cutoff = ms(r) + 24 * 60 * 60 * 1000;
    const own = allEvents.filter(
      (e) => e.ownerId === r.ownerId && e.type === 'task_delivered' && e.taskId && ms(e) <= cutoff,
    );
    if (own.some((e) => adoptedTasks.has(e.taskId!))) activated++;
  }

  return {
    weekStartIso: new Date(start).toISOString(),
    weekEndIso: new Date(end).toISOString(),
    effectiveWorkflowsByOwner: byOwner,
    activeUsers,
    perActiveUser: activeUsers ? total / activeUsers : 0,
    usersAtTarget: activeUsers ? counts.filter((c) => c >= 3).length / activeUsers : 0,
    funnel: {
      submitted,
      delivered,
      adopted,
      completionRate: submitted ? delivered / submitted : 0,
      adoptionRate: delivered ? adopted / delivered : 0,
    },
    activation: {
      registered: registered.length,
      activated,
      rate: registered.length ? activated / registered.length : 0,
    },
  };
}

/** Weekly report markdown (S30-T3): the operating cadence around the north star. */
export function weeklyReportMarkdown(cur: WeeklyNorthStar, prev?: WeeklyNorthStar): string {
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const delta = (a: number, b?: number) =>
    b === undefined || b === 0 ? '' : ` (WoW ${a >= b ? '+' : ''}${(((a - b) / b) * 100).toFixed(0)}%)`;
  return [
    `# North-star weekly — week of ${cur.weekStartIso.slice(0, 10)}`,
    '',
    `- **Effective workflows / active user: ${cur.perActiveUser.toFixed(2)}**${delta(cur.perActiveUser, prev?.perActiveUser)} (target ≥ 3)`,
    `- Active users (≥1 effective workflow): ${cur.activeUsers}${delta(cur.activeUsers, prev?.activeUsers)}`,
    `- Users at target (≥3/week): ${pct(cur.usersAtTarget)}`,
    `- Activation (first artifact within 24h of signup): ${pct(cur.activation.rate)} (${cur.activation.activated}/${cur.activation.registered}, target ≥ 30%)`,
    `- Task completion: ${pct(cur.funnel.completionRate)} (${cur.funnel.delivered}/${cur.funnel.submitted}, target ≥ 75%)`,
    `- Artifact adoption: ${pct(cur.funnel.adoptionRate)} (${cur.funnel.adopted}/${cur.funnel.delivered}, target ≥ 25%)`,
    '',
    cur.perActiveUser >= 3
      ? 'On target.'
      : 'Below target — per the MVP plan, prioritize root-cause analysis over new features.',
  ].join('\n');
}
