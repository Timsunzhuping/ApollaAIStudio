import { describe, it, expect } from 'vitest';
import type { ModelAlias, RouteConfig } from '@apolla/contracts';
import { ModelRouter } from '../router/router';
import { MockAdapter } from '../router/mock';
import { PromptRegistry } from '../prompts/registry';
import { ToolRuntime } from '../tools/runtime';
import { StubMCPClient } from '../tools/mcp-stub';
import { AgentOrchestrator } from '../agent/orchestrator';
import { InMemoryWorkspaceRepository } from '../workspace/memory';
import { Coordinator, type CoworkEvent } from './coordinator';

const prompts = new PromptRegistry([
  { promptId: 'agent.step', version: '1', scene: 'a', template: 'Decide.', safetyConstraints: [], rollout: 1 },
  { promptId: 'cowork.synthesize', version: '1', scene: 's', template: 'Synthesize.', safetyConstraints: [], rollout: 1 },
]);
function router(): ModelRouter {
  return new ModelRouter({
    adapters: new Map([['m', new MockAdapter('m', { jsonSequence: ['{"action":"finish","answer":"section text"}'], streamText: 'FINAL BRIEF' })]]),
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

describe('Cowork file collaboration (S7-T4)', () => {
  it('persists each section + the brief to the workspace when authorized', async () => {
    const r = router();
    const ws = new InMemoryWorkspaceRepository();
    const coord = new Coordinator({ agent: new AgentOrchestrator({ router: r, tools: await tools(), prompts }), router: r, prompts, workspace: ws });
    const events = await collect(
      coord.run({ ownerId: 'u', goal: 'g', subgoals: ['a', 'b'], taskId: 't1', files: { enabled: true, basePath: 'cowork/t1' } }),
    );
    const written = events.filter((e) => e.type === 'file-written').map((e) => e.type === 'file-written' && e.path);
    expect(written).toEqual(['cowork/t1/sections/1.md', 'cowork/t1/sections/2.md', 'cowork/t1/brief.md']);
    expect((await ws.list('u')).map((f) => f.path)).toEqual(['cowork/t1/brief.md', 'cowork/t1/sections/1.md', 'cowork/t1/sections/2.md']);
    expect((await ws.read('u', 'cowork/t1/brief.md'))?.content.trim()).toBe('FINAL BRIEF');
  });

  it('writes no files when collaboration is not authorized (background safe)', async () => {
    const r = router();
    const ws = new InMemoryWorkspaceRepository();
    const coord = new Coordinator({ agent: new AgentOrchestrator({ router: r, tools: await tools(), prompts }), router: r, prompts, workspace: ws });
    const events = await collect(coord.run({ ownerId: 'u', goal: 'g', subgoals: ['a', 'b'], taskId: 't2', files: { enabled: false, basePath: 'cowork/t2' } }));
    expect(events.some((e) => e.type === 'file-written')).toBe(false);
    expect(await ws.list('u')).toHaveLength(0);
    expect(events.at(-1)?.type).toBe('done');
  });
});
