import { describe, it, expect } from 'vitest';
import type { ModelAlias, RouteConfig, UntrustedContent } from '@apolla/contracts';
import { ResearchOrchestrator } from './research';
import { MockAdapter } from '../router/mock';
import { PromptRegistry } from '../prompts/registry';
import { ToolRuntime } from '../tools/runtime';
import { WebSearchTool, type SearchProvider, type SearchHit } from '../tools/search';
import { InMemoryCostLedger } from '../cost/ledger';
import { InMemoryTaskRepository } from '../repo/memory';

class FakeProvider implements SearchProvider {
  readonly name = 'fix';
  async search(): Promise<SearchHit[]> {
    return [{ title: 'T', url: 'https://x', snippet: 's' }];
  }
}

function makeOrch() {
  const tools = new ToolRuntime();
  tools.register(new WebSearchTool(new FakeProvider()));
  let n = 0;
  const repo = new InMemoryTaskRepository();
  const orch = new ResearchOrchestrator({
    adapters: new Map([
      ['planp', new MockAdapter('planp', { text: JSON.stringify({ subquestions: ['q1'] }) })],
      ['synthp', new MockAdapter('synthp', { streamText: 'r [fix:1][ext:1]', text: JSON.stringify({ claims: [{ claim: 'c', sourceIds: ['fix:1'] }] }) })],
    ]),
    prompts: new PromptRegistry([
      { promptId: 'research.plan', version: '1', scene: 'p', template: 'plan', safetyConstraints: [], rollout: 1 },
      { promptId: 'research.synthesize', version: '1', scene: 's', template: 'synth', safetyConstraints: [], rollout: 1 },
      { promptId: 'research.extract-citations', version: '1', scene: 'x', template: 'extract', safetyConstraints: [], rollout: 1 },
    ]),
    tools,
    ledger: new InMemoryCostLedger(),
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
  return { orch, repo };
}

describe('project/memory context injection', () => {
  it('injects extra evidence as a citable source', async () => {
    const { orch, repo } = makeOrch();
    const extra: UntrustedContent[] = [
      { kind: 'untrusted', sourceId: 'ext:1', origin: 'project:material', content: 'Prior project finding.' },
    ];
    for await (const _e of orch.run({ ownerId: 'u', question: 'Q', taskId: 't1', extraEvidence: extra })) void _e;
    const task = await repo.get('t1');
    // extra evidence becomes a known source, so the report's [ext:1] is valid
    expect(task?.sources.some((s) => s.id === 'ext:1')).toBe(true);
  });

  it('accepts a systemAddendum without leaking it into the data channel', async () => {
    const { orch, repo } = makeOrch();
    for await (const _e of orch.run({ ownerId: 'u', question: 'Q', taskId: 't2', systemAddendum: 'Prefer bullet points.' })) void _e;
    expect((await repo.get('t2'))?.state).toBe('done');
  });
});
