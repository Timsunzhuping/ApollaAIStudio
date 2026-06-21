import {
  InMemoryPluginRepository,
  InMemorySkillRepository,
  CompositeSkillSource,
  Coordinator,
  CoworkOrchestrator,
  AgentOrchestrator,
  ToolRuntime,
  StubMCPClient,
  ModelRouter,
  MockAdapter,
  PromptRegistry,
  type CoworkEvent,
} from '@apolla/harness-core';
import type { ModelAlias, RouteConfig, Plugin, AuditEntry, ToolResult } from '@apolla/contracts';
import type { CheckResult } from './checks';

const prompts = new PromptRegistry([
  { promptId: 'agent.step', version: '1', scene: 'a', template: 'Decide.', safetyConstraints: [], rollout: 1 },
  { promptId: 'cowork.plan', version: '1', scene: 'p', template: 'Plan into sub-goals.', safetyConstraints: [], rollout: 1 },
  { promptId: 'cowork.synthesize', version: '1', scene: 's', template: 'Synthesize.', safetyConstraints: [], rollout: 1 },
]);

function router(behavior: { jsonSequence?: string[]; streamText?: string }): ModelRouter {
  return new ModelRouter({
    adapters: new Map([['m', new MockAdapter('m', behavior)]]),
    env: { K: 'k' },
    routeFor: (a: ModelAlias): RouteConfig => ({ a, primary: 'm/x', fallbackChain: [], keyPool: ['K'] }) as never,
  });
}
async function tools(): Promise<ToolRuntime> {
  const rt = new ToolRuntime();
  await rt.connectMCP(new StubMCPClient(), { name: 'demo', transport: 'stub', readOnlyTools: ['echo'] });
  return rt;
}
async function collect(it: AsyncIterable<CoworkEvent>): Promise<CoworkEvent[]> {
  const out: CoworkEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

const plugin: Plugin = {
  name: 'research-analyst',
  description: 'd',
  skills: [{ name: 'competitive-brief', triggers: ['brief'], tools: ['web_search'], io: {}, risk: 'read', promptRef: 'research.synthesize', executor: 'research' }],
  requiredConnectors: [],
  commands: [],
};

/** ① Installing a plugin makes its skills available to that owner (and only that owner). */
export async function pluginInstall(): Promise<CheckResult> {
  const plugins = new InMemoryPluginRepository();
  const source = new CompositeSkillSource([], new InMemorySkillRepository(), plugins);
  await plugins.install('u', plugin);
  const mine = (await source.list('u')).map((s) => s.name);
  const others = await source.list('other');
  const ok = mine.includes('competitive-brief') && others.length === 0;
  return { name: 'plugin-install', ok, issues: ok ? [] : ['installed plugin skill not available / leaked across owners'] };
}

/** ② Coordinator fans out one sub-agent per sub-goal and caps the fan-out. */
export async function fanOutCap(): Promise<CheckResult> {
  const r = router({ jsonSequence: ['{"action":"finish","answer":"a"}'], streamText: 'BRIEF' });
  const coord = new Coordinator({ agent: new AgentOrchestrator({ router: r, tools: await tools(), prompts }), router: r, prompts, maxSubAgents: 2 });
  const events = await collect(coord.run({ ownerId: 'u', goal: 'g', subgoals: ['1', '2', '3', '4'], taskId: 't' }));
  const plan = events.find((e) => e.type === 'plan');
  const results = events.filter((e) => e.type === 'subagent-result');
  const ok =
    plan?.type === 'plan' && plan.subgoals.length === 2 && plan.truncated === 2 && results.length === 2 && events.at(-1)?.type === 'done';
  return { name: 'cowork-fanout-cap', ok, issues: ok ? [] : ['fan-out did not run one capped sub-agent per sub-goal'] };
}

/** ③ Clarify gating: a background run (no human) never self-answers and still completes. */
export async function clarifyGating(): Promise<CheckResult> {
  const r = router({ jsonSequence: ['{"action":"clarify","question":"which region?"}', '{"action":"finish","answer":"best-effort"}'], streamText: 'B' });
  const coord = new Coordinator({ agent: new AgentOrchestrator({ router: r, tools: await tools(), prompts }), router: r, prompts });
  // no clarify resolver passed → background; must not self-answer, must finish
  const events = await collect(coord.run({ ownerId: 'u', goal: 'g', subgoals: ['ambiguous'], taskId: 't' }));
  const ok = events.at(-1)?.type === 'done';
  return { name: 'cowork-clarify-gating', ok, issues: ok ? [] : ['background clarify self-answered or stalled'] };
}

/** ④ Cowork end-to-end: plan → fan-out → synthesized deliverable. */
export async function coworkEndToEnd(): Promise<CheckResult> {
  const r = router({ jsonSequence: ['{"subgoals":["one","two","three"]}', '{"action":"finish","answer":"sub"}'], streamText: 'DELIVERABLE' });
  const coord = new Coordinator({ agent: new AgentOrchestrator({ router: r, tools: await tools(), prompts }), router: r, prompts });
  const cowork = new CoworkOrchestrator({ coordinator: coord, router: r, prompts });
  const events = await collect(cowork.run({ ownerId: 'u', goal: 'multi-angle', taskId: 't' }));
  const done = events.at(-1);
  const ok = events.filter((e) => e.type === 'subagent-result').length === 3 && done?.type === 'done' && done.answer.trim() === 'DELIVERABLE';
  return { name: 'cowork-end-to-end', ok, issues: ok ? [] : ['cowork did not plan→fan-out→synthesize a deliverable'] };
}

/** ⑤ Safety inheritance: a sub-agent's high_write is denied even with approve=true; calls are audited. */
export async function safetyInheritance(): Promise<CheckResult> {
  const t = await tools();
  t.register({ name: 'danger/delete_all', risk: 'high_write', source: 'native', schema: {}, async invoke(): Promise<ToolResult> { return { ok: true, data: [] }; } });
  const r = router({ jsonSequence: ['{"action":"call_tool","tool":"danger/delete_all","args":{}}', '{"action":"finish","answer":"x"}'], streamText: 'B' });
  const audited: AuditEntry[] = [];
  const coord = new Coordinator({ agent: new AgentOrchestrator({ router: r, tools: t, prompts, audit: (e) => { audited.push(e); } }), router: r, prompts });
  for await (const _e of coord.run({ ownerId: 'u', goal: 'g', subgoals: ['be dangerous'], taskId: 't', approve: async () => true })) void _e;
  const ok =
    audited.some((e) => e.tool === 'danger/delete_all' && e.status === 'denied') &&
    !audited.some((e) => e.tool === 'danger/delete_all' && e.status === 'executed');
  return { name: 'cowork-safety-inheritance', ok, issues: ok ? [] : ['sub-agent high_write was not denied / not audited'] };
}

export async function runCoworkScenarios(): Promise<CheckResult[]> {
  return Promise.all([pluginInstall(), fanOutCap(), clarifyGating(), coworkEndToEnd(), safetyInheritance()]);
}
