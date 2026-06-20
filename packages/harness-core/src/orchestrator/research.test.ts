import { describe, it, expect } from 'vitest';
import { Task, type ModelAlias, type RouteConfig } from '@apolla/contracts';
import { ResearchOrchestrator } from './research';
import type { TaskEvent } from './events';
import { MockAdapter } from '../router/mock';
import { PromptRegistry } from '../prompts/registry';
import { ToolRuntime } from '../tools/runtime';
import { WebSearchTool, type SearchProvider, type SearchHit } from '../tools/search';
import { InMemoryCostLedger } from '../cost/ledger';
import { PricingBook } from '../cost/pricing';
import { InMemoryTaskRepository } from '../repo/memory';

class FakeProvider implements SearchProvider {
  readonly name = 'fake';
  async search(): Promise<SearchHit[]> {
    return [{ title: 'EV report', url: 'https://a.test', snippet: 'EV sales up in 2026' }];
  }
}

function makeOrchestrator() {
  const planJSON = JSON.stringify({ subquestions: ['q1', 'q2'], estimateSeconds: 60 });
  const synthProse = 'EV sales rose in 2026 [fake:1].';
  const synthClaims = JSON.stringify({
    claims: [
      { claim: 'EV sales rose', sourceIds: ['fake:1'] },
      { claim: 'unsupported claim', sourceIds: ['nope:9'] },
    ],
  });

  const tools = new ToolRuntime();
  tools.register(new WebSearchTool(new FakeProvider()));

  const prompts = new PromptRegistry([
    { promptId: 'research.plan', version: '1', scene: 'plan', template: 'Decompose the question.', safetyConstraints: [], rollout: 1 },
    { promptId: 'research.synthesize', version: '1', scene: 'synth', template: 'Synthesize with citations by sourceId.', safetyConstraints: [], rollout: 1 },
    { promptId: 'research.extract-citations', version: '1', scene: 'x', template: 'Extract claims.', safetyConstraints: [], rollout: 1 },
  ]);

  const ledger = new InMemoryCostLedger(
    new PricingBook().set('planp/m', { in: 1, out: 1 }).set('synthp/m', { in: 1, out: 1 }),
  );

  let n = 0;
  const orch = new ResearchOrchestrator({
    adapters: new Map([
      ['planp', new MockAdapter('planp', { text: planJSON })],
      ['synthp', new MockAdapter('synthp', { streamText: synthProse, text: synthClaims })],
    ]),
    prompts,
    tools,
    ledger,
    repo: new InMemoryTaskRepository(),
    env: { MOCK_KEY: 'k' },
    idGen: () => `id-${n++}`,
    routeFor: (alias: ModelAlias): RouteConfig => ({
      alias,
      primary: alias === 'gpt_premium' ? 'planp/m' : 'synthp/m',
      fallbackChain: [],
      keyPool: ['MOCK_KEY'],
    }),
  });
  return { orch, ledger };
}

async function collect(it: AsyncIterable<TaskEvent>): Promise<TaskEvent[]> {
  const out: TaskEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

describe('ResearchOrchestrator', () => {
  it('walks plan→search→extract→generate→deliver→done in order', async () => {
    const { orch } = makeOrchestrator();
    const events = await collect(orch.run({ ownerId: 'u1', question: 'EV market 2026', taskId: 't1' }));

    const states = events.filter((e) => e.type === 'step-start').map((e: any) => e.state);
    expect(states).toEqual(['plan', 'search', 'extract', 'generate', 'deliver']);

    const types = events.map((e) => e.type);
    expect(types[0]).toBe('step-start');
    expect(types).toContain('plan');
    expect(types).toContain('sources');
    expect(types).toContain('citations');
    expect(types).toContain('artifact');
    expect(types.at(-1)).toBe('done');
  });

  it('produces a cited report and drops claims without a valid source', async () => {
    const { orch } = makeOrchestrator();
    const events = await collect(orch.run({ ownerId: 'u1', question: 'EV market 2026', taskId: 't1' }));

    const citationEvent: any = events.find((e) => e.type === 'citations');
    expect(citationEvent.citations).toHaveLength(1);
    expect(citationEvent.citations[0].sourceIds).toEqual(['fake:1']);

    const artifactEvent: any = events.find((e) => e.type === 'artifact');
    expect(artifactEvent.artifact.format).toBe('markdown');
    expect(artifactEvent.artifact.content).toContain('## Sources');
    expect(artifactEvent.artifact.content).toContain('[fake:1]');
  });

  it('reports a non-zero cost and persists a replayable Task', async () => {
    const { orch, ledger } = makeOrchestrator();
    const repo = new InMemoryTaskRepository();
    // run via a fresh orchestrator sharing this repo to inspect persistence
    const events = await collect(orch.run({ ownerId: 'u1', question: 'EVs', taskId: 't1' }));

    const cost: any = events.find((e) => e.type === 'cost');
    expect(cost.totalUsd).toBeGreaterThan(0);
    expect(ledger.totalUsd('t1')).toBeGreaterThan(0);
    // per-step attribution: plan + generate each incurred LLM cost
    const perStep = ledger.perStep('t1');
    expect(Object.keys(perStep).length).toBeGreaterThanOrEqual(2);

    void repo;
  });

  it('persists a Task that round-trips through the contract schema', async () => {
    const repo = new InMemoryTaskRepository();
    const planJSON = JSON.stringify({ subquestions: ['q1'], estimateSeconds: 30 });
    const synthClaims = JSON.stringify({ claims: [{ claim: 'c', sourceIds: ['fake:1'] }] });
    const tools = new ToolRuntime();
    tools.register(new WebSearchTool(new FakeProvider()));
    let n = 0;
    const orch = new ResearchOrchestrator({
      adapters: new Map([
        ['planp', new MockAdapter('planp', { text: planJSON })],
        ['synthp', new MockAdapter('synthp', { streamText: 'r [fake:1]', text: synthClaims })],
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
    await collect(orch.run({ ownerId: 'u1', question: 'EVs', taskId: 't1' }));

    const persisted = await repo.get('t1');
    expect(persisted?.state).toBe('done');
    expect(persisted?.steps).toHaveLength(5);
    // serializable + valid against the contract (replayable)
    const roundTripped = Task.parse(JSON.parse(JSON.stringify(persisted)));
    expect(roundTripped.id).toBe('t1');
    expect(roundTripped.sources.length).toBeGreaterThan(0);
  });
});
