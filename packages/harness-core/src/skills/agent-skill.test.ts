import { describe, it, expect } from 'vitest';
import type { ModelAlias, RouteConfig, SkillDef } from '@apolla/contracts';
import { SkillRuntime } from './runtime';
import { makeAgentExecutor, makeGenericExecutor } from './executors';
import { ModelRouter } from '../router/router';
import { MockAdapter } from '../router/mock';
import { PromptRegistry } from '../prompts/registry';
import { ToolRuntime } from '../tools/runtime';
import { StubMCPClient } from '../tools/mcp-stub';
import { CompositeSkillSource, InMemorySkillRepository } from '../repo/memory';
import type { SkillEvent } from './types';

const agentSkill: SkillDef = {
  name: 'web-agent',
  triggers: ['agent', 'use tools'],
  tools: ['web_search'],
  io: {},
  risk: 'read',
  promptRef: 'agent.step',
  executor: 'agent',
};

function build() {
  const router = new ModelRouter({
    adapters: new Map([
      ['m', new MockAdapter('m', { jsonSequence: [
        JSON.stringify({ action: 'call_tool', tool: 'demo/echo', args: { text: 'hi' } }),
        JSON.stringify({ action: 'finish', answer: 'done' }),
      ] })],
    ]),
    env: { K: 'k' },
    routeFor: (a: ModelAlias): RouteConfig => ({ a, primary: 'm/x', fallbackChain: [], keyPool: ['K'] }) as never,
  });
  const prompts = new PromptRegistry([
    { promptId: 'agent.step', version: '1', scene: 'a', template: 'Decide.', safetyConstraints: [], rollout: 1 },
  ]);
  const toolsFor = async () => {
    const rt = new ToolRuntime();
    await rt.connectMCP(new StubMCPClient(), { name: 'demo', transport: 'stub', readOnlyTools: ['echo'] });
    return rt;
  };
  const runtime = new SkillRuntime(
    new CompositeSkillSource([agentSkill], new InMemorySkillRepository()),
    makeGenericExecutor({ router, prompts }),
  );
  runtime.registerExecutor('agent', makeAgentExecutor({ router, prompts, toolsFor }));
  return runtime;
}

async function collect(it: AsyncIterable<SkillEvent>): Promise<SkillEvent[]> {
  const out: SkillEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

describe('agent skills', () => {
  it('matches and runs an agent skill through the AgentOrchestrator', async () => {
    const runtime = build();
    expect((await runtime.match('run the agent on this')).map((s) => s.name)).toContain('web-agent');
    const skill = (await runtime.get('web-agent'))!;
    const types = (await collect(runtime.run(skill, { ownerId: 'u', question: 'find EV facts' }))).map((e) => e.type);
    expect(types).toContain('tool-call');
    expect(types.at(-1)).toBe('done');
  });
});
