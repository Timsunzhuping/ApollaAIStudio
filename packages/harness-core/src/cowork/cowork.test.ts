import { describe, it, expect } from 'vitest';
import type { ModelAlias, RouteConfig } from '@apolla/contracts';
import { ModelRouter } from '../router/router';
import { MockAdapter } from '../router/mock';
import { PromptRegistry } from '../prompts/registry';
import { ToolRuntime } from '../tools/runtime';
import { StubMCPClient } from '../tools/mcp-stub';
import { AgentOrchestrator } from '../agent/orchestrator';
import { Coordinator, type CoworkEvent } from './coordinator';
import { CoworkOrchestrator } from './orchestrator';

const prompts = new PromptRegistry([
  { promptId: 'agent.step', version: '1', scene: 'a', template: 'Decide.', safetyConstraints: [], rollout: 1 },
  { promptId: 'cowork.plan', version: '1', scene: 'p', template: 'Plan.', safetyConstraints: [], rollout: 1 },
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

describe('Coordinator (sub-agent fan-out)', () => {
  it('fans out to one sub-agent per sub-goal, in parallel, then synthesizes', async () => {
    const r = router({ jsonSequence: ['{"action":"finish","answer":"sub answer"}'], streamText: 'FINAL BRIEF' });
    const coord = new Coordinator({ agent: new AgentOrchestrator({ router: r, tools: await tools(), prompts }), router: r, prompts });
    const events = await collect(
      coord.run({ ownerId: 'u', goal: 'research X', subgoals: ['angle a', 'angle b', 'angle c'], taskId: 't' }),
    );
    const results = events.filter((e) => e.type === 'subagent-result');
    expect(results).toHaveLength(3);
    expect(results.every((e) => e.type === 'subagent-result' && e.result.ok)).toBe(true);
    const done = events.at(-1);
    expect(done?.type).toBe('done');
    expect(done?.type === 'done' && done.answer.trim()).toBe('FINAL BRIEF');
  });

  it('caps fan-out at maxSubAgents and reports what it dropped', async () => {
    const r = router({ jsonSequence: ['{"action":"finish","answer":"x"}'], streamText: 'BRIEF' });
    const coord = new Coordinator({
      agent: new AgentOrchestrator({ router: r, tools: await tools(), prompts }),
      router: r,
      prompts,
      maxSubAgents: 2,
    });
    const events = await collect(
      coord.run({ ownerId: 'u', goal: 'g', subgoals: ['1', '2', '3', '4', '5'], taskId: 't' }),
    );
    const plan = events[0];
    expect(plan?.type === 'plan' && plan.subgoals).toHaveLength(2);
    expect(plan?.type === 'plan' && plan.truncated).toBe(3);
    expect(events.filter((e) => e.type === 'subagent-result')).toHaveLength(2);
  });
});

describe('CoworkOrchestrator (integrative)', () => {
  it('plans sub-goals from the goal, fans out, and delivers one answer', async () => {
    const r = router({
      jsonSequence: ['{"subgoals":["one","two","three"]}', '{"action":"finish","answer":"sub"}'],
      streamText: 'COWORK DELIVERABLE',
    });
    const coord = new Coordinator({ agent: new AgentOrchestrator({ router: r, tools: await tools(), prompts }), router: r, prompts });
    const cowork = new CoworkOrchestrator({ coordinator: coord, router: r, prompts });
    const events = await collect(cowork.run({ ownerId: 'u', goal: 'multi-angle research', taskId: 't' }));
    expect(events.filter((e) => e.type === 'subagent-result')).toHaveLength(3);
    const done = events.at(-1);
    expect(done?.type === 'done' && done.answer.trim()).toBe('COWORK DELIVERABLE');
  });
});
