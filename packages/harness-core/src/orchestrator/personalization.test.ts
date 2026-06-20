import { describe, it, expect } from 'vitest';
import type { ModelAlias, RouteConfig } from '@apolla/contracts';
import { ResearchOrchestrator } from './research';
import { MockAdapter } from '../router/mock';
import { PromptRegistry } from '../prompts/registry';
import { ToolRuntime } from '../tools/runtime';
import { WebSearchTool, type SearchProvider, type SearchHit } from '../tools/search';
import { InMemoryCostLedger } from '../cost/ledger';
import { InMemoryTaskRepository } from '../repo/memory';
import { InMemoryMemory } from '../memory/memory';

class FakeProvider implements SearchProvider {
  readonly name = 'fix';
  async search(): Promise<SearchHit[]> {
    return [{ title: 'T', url: 'https://x', snippet: 's' }];
  }
}

describe('memory personalization injection', () => {
  it('injects the user model into the system channel and notes the run', async () => {
    const memory = new InMemoryMemory();
    await memory.setUserModel('u1', { language: 'Chinese', style: 'bulleted' });

    const tools = new ToolRuntime();
    tools.register(new WebSearchTool(new FakeProvider()));
    const planMock = new MockAdapter('planp', { text: JSON.stringify({ subquestions: ['q1'] }) });
    const synthMock = new MockAdapter('synthp', {
      streamText: 'r [fix:1]',
      text: JSON.stringify({ claims: [{ claim: 'c', sourceIds: ['fix:1'] }] }),
    });
    let n = 0;
    const orch = new ResearchOrchestrator({
      adapters: new Map([
        ['planp', planMock],
        ['synthp', synthMock],
      ]),
      prompts: new PromptRegistry([
        { promptId: 'research.plan', version: '1', scene: 'p', template: 'plan', safetyConstraints: [], rollout: 1 },
        { promptId: 'research.synthesize', version: '1', scene: 's', template: 'synth', safetyConstraints: [], rollout: 1 },
        { promptId: 'research.extract-citations', version: '1', scene: 'x', template: 'extract', safetyConstraints: [], rollout: 1 },
      ]),
      tools,
      ledger: new InMemoryCostLedger(),
      repo: new InMemoryTaskRepository(),
      memory,
      env: { MOCK_KEY: 'k' },
      idGen: () => `id-${n++}`,
      routeFor: (alias: ModelAlias): RouteConfig => ({
        alias,
        primary: alias === 'gpt_premium' ? 'planp/m' : 'synthp/m',
        fallbackChain: [],
        keyPool: ['MOCK_KEY'],
      }),
    });

    for await (const _e of orch.run({ ownerId: 'u1', question: 'EV market', taskId: 't1' })) void _e;

    // the user-model directive reached the system (instruction) channel of the plan call
    const planSystem = planMock.reqs[0]!.messages.find((m) => m.role === 'system')!.content;
    expect(planSystem).toContain('Chinese');
    expect(planSystem).toContain('bulleted');

    // the run was noted back to memory for future recall
    const recalled = await memory.recall('u1', 'EV market');
    expect(recalled.length).toBeGreaterThan(0);
  });
});
