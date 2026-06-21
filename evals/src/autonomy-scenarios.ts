import {
  Scheduler,
  InMemoryScheduledTaskRepository,
  JobRunner,
  InMemoryJobRepository,
  notifyJobComplete,
  StubDelivery,
  InMemoryNotificationRepository,
  AgentOrchestrator,
  ToolRuntime,
  StubMCPClient,
  ModelRouter,
  MockAdapter,
  PromptRegistry,
  type AgentEvent,
} from '@apolla/harness-core';
import type { ModelAlias, RouteConfig, ScheduledTask, JobSpec } from '@apolla/contracts';
import type { CheckResult } from './checks';

const prompts = new PromptRegistry([
  { promptId: 'agent.step', version: '1', scene: 'a', template: 'Decide.', safetyConstraints: [], rollout: 1 },
]);
const spec: JobSpec = { kind: 'research', input: { question: 'x' }, allowTools: [] };

/** ① Scheduler fires a due task at its cron minute. */
export async function schedulerTrigger(): Promise<CheckResult> {
  const repo = new InMemoryScheduledTaskRepository();
  const task: ScheduledTask = { id: 's1', ownerId: 'u', name: 'd', cron: '30 8 * * *', jobSpec: spec, enabled: true };
  await repo.save(task);
  const fired: string[] = [];
  const scheduler = new Scheduler({ repo, trigger: (t) => { fired.push(t.id); } });
  const due = await scheduler.tick(new Date('2026-06-21T08:30:00Z'));
  const notDue = await scheduler.tick(new Date('2026-06-21T09:00:00Z'));
  const ok = due.includes('s1') && !notDue.includes('s1');
  return { name: 'scheduler-trigger', ok, issues: ok ? [] : ['scheduler did not fire at the due minute'] };
}

/** ② Background job completes and its run-log replays in order. */
export async function backgroundJob(): Promise<CheckResult> {
  const repo = new InMemoryJobRepository();
  const runner = new JobRunner({
    repo,
    idGen: () => 'jb',
    resolve: async function* () {
      yield { type: 'plan' };
      yield { type: 'done' };
    },
  });
  const { job, done } = await runner.start('u', spec);
  await done;
  const events = (await repo.events(job.id)).map((e: any) => e.type);
  const ok = (await repo.get(job.id))?.status === 'done' && events.join(',') === 'plan,done';
  return { name: 'background-job-replay', ok, issues: ok ? [] : ['job did not complete with an ordered run-log'] };
}

/** ③ Job completion produces a notification + out-of-band delivery. */
export async function notificationDelivery(): Promise<CheckResult> {
  const jobRepo = new InMemoryJobRepository();
  const notifRepo = new InMemoryNotificationRepository();
  const delivery = new StubDelivery();
  let n = 0;
  const runner = new JobRunner({
    repo: jobRepo,
    idGen: () => 'jn',
    resolve: async function* () { yield { type: 'done' }; },
    onComplete: (job) => notifyJobComplete(job, { repo: notifRepo, delivery, idGen: () => `n${n++}` }),
  });
  await (await runner.start('u', spec)).done;
  const ok = (await notifRepo.list('u')).length === 1 && delivery.sent.length === 1;
  return { name: 'notification-delivery', ok, issues: ok ? [] : ['notification or delivery missing'] };
}

function decisions(seq: object[]): ModelRouter {
  return new ModelRouter({
    adapters: new Map([['m', new MockAdapter('m', { jsonSequence: seq.map((d) => JSON.stringify(d)) })]]),
    env: { K: 'k' },
    routeFor: (a: ModelAlias): RouteConfig => ({ a, primary: 'm/x', fallbackChain: [], keyPool: ['K'] }) as never,
  });
}
async function agentTools(): Promise<ToolRuntime> {
  const rt = new ToolRuntime();
  await rt.connectMCP(new StubMCPClient(), { name: 'demo', transport: 'stub', readOnlyTools: ['echo'] });
  return rt;
}
async function runAgent(allow: string[]): Promise<AgentEvent[]> {
  const router = decisions([
    { action: 'call_tool', tool: 'demo/save_note', args: { text: 'x' } },
    { action: 'finish', answer: 'd' },
  ]);
  const set = new Set(allow);
  const out: AgentEvent[] = [];
  for await (const e of new AgentOrchestrator({ router, tools: await agentTools(), prompts }).run({ ownerId: 'u', goal: 'g', taskId: 't', approve: async (c) => set.has(c.tool) })) {
    out.push(e);
  }
  return out;
}

/** ④ Background safety: read-only by default; pre-authorized allowlist runs low_write. */
export async function backgroundSafety(): Promise<CheckResult> {
  const denied = await runAgent([]); // no allowlist → background read-only
  const allowed = await runAgent(['demo/save_note']); // pre-authorized
  const ok =
    !denied.some((e) => e.type === 'tool-result') &&
    denied.some((e) => e.type === 'denied') &&
    allowed.some((e) => e.type === 'tool-result');
  return { name: 'background-safety', ok, issues: ok ? [] : ['background safety/allowlist did not hold'] };
}

export async function runAutonomyScenarios(): Promise<CheckResult[]> {
  return Promise.all([schedulerTrigger(), backgroundJob(), notificationDelivery(), backgroundSafety()]);
}
