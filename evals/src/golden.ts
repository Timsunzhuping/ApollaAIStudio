import {
  ResearchOrchestrator,
  PromptRegistry,
  ToolRuntime,
  WebSearchTool,
  InMemoryCostLedger,
  InMemoryTaskRepository,
  PricingBook,
  MockAdapter,
  type SearchProvider,
  type SearchHit,
} from '@apolla/harness-core';
import type { ModelAlias, RouteConfig, Task } from '@apolla/contracts';

/** Deterministic fixture search — the eval never touches the network. */
class FixtureProvider implements SearchProvider {
  readonly name = 'fix';
  async search(): Promise<SearchHit[]> {
    return [
      { title: 'EV sales 2026', url: 'https://ex.test/1', snippet: 'EV sales grew 18% in 2026.' },
      { title: 'Battery costs', url: 'https://ex.test/2', snippet: 'Battery pack prices fell further.' },
    ];
  }
}

export interface GoldenResult {
  task: Task;
  totalUsd: number;
}

/** Run the research closed-loop deterministically (mock LLM + fixture search). */
export async function runGolden(): Promise<GoldenResult> {
  const planJSON = JSON.stringify({
    subquestions: ['EV sales trend 2026', 'EV battery cost 2026'],
    estimateSeconds: 60,
  });
  const synthJSON = JSON.stringify({
    report: '## Overview\nEV sales grew in 2026 [fix:1]. Battery costs fell [fix:2].',
    claims: [
      { claim: 'EV sales grew in 2026', sourceIds: ['fix:1'] },
      { claim: 'Battery costs fell', sourceIds: ['fix:2'] },
    ],
  });

  const tools = new ToolRuntime();
  tools.register(new WebSearchTool(new FixtureProvider()));

  const ledger = new InMemoryCostLedger(
    new PricingBook().set('planp/m', { in: 0.001, out: 0.002 }).set('synthp/m', { in: 0.001, out: 0.002 }),
  );
  const repo = new InMemoryTaskRepository();

  let n = 0;
  const orch = new ResearchOrchestrator({
    adapters: new Map([
      ['planp', new MockAdapter('planp', { text: planJSON })],
      ['synthp', new MockAdapter('synthp', { text: synthJSON })],
    ]),
    prompts: new PromptRegistry([
      { promptId: 'research.plan', version: '1', scene: 'p', template: 'plan', safetyConstraints: [], rollout: 1 },
      { promptId: 'research.synthesize', version: '1', scene: 's', template: 'synth', safetyConstraints: [], rollout: 1 },
    ]),
    tools,
    ledger,
    repo,
    env: { MOCK_KEY: 'k' },
    idGen: () => `id-${n++}`,
    routeFor: (alias: ModelAlias): RouteConfig => ({
      alias,
      primary: alias === 'gpt_premium' ? 'planp/m' : 'synthp/m',
      fallbackChain: [],
      keyPool: ['MOCK_KEY'],
    }),
  });

  for await (const _e of orch.run({ ownerId: 'eval', question: 'State of the EV market in 2026', taskId: 'golden-1' })) {
    // drain the event stream
  }

  const task = await repo.get('golden-1');
  if (!task) throw new Error('golden task was not persisted');
  return { task, totalUsd: ledger.totalUsd('golden-1') };
}
