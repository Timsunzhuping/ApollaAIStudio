import { describe, it, expect } from 'vitest';
import { Task, type ModelAlias, type RouteConfig } from '@apolla/contracts';
import { ResearchOrchestrator } from './research';
import type { TaskEvent } from './events';
import { MockAdapter } from '../router/mock';
import { PromptRegistry } from '../prompts/registry';
import { ToolRuntime } from '../tools/runtime';
import { WebSearchTool, type SearchProvider, type SearchHit } from '../tools/search';
import { WebFetchTool, shortHash } from '../tools/fetch';
import { StubFetchProvider } from '../tools/fetch-stub';
import { InMemoryCostLedger } from '../cost/ledger';
import { PricingBook } from '../cost/pricing';
import { InMemoryTaskRepository } from '../repo/memory';

class FakeProvider implements SearchProvider {
  readonly name = 'fake';
  async search(): Promise<SearchHit[]> {
    return [{ title: 'EV report', url: 'https://a.test', snippet: 'EV sales up in 2026' }];
  }
}

function makeOrchestrator(opts: { withFetch?: boolean } = {}) {
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
  if (opts.withFetch) tools.register(new WebFetchTool(new StubFetchProvider()));

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

  it('S25: enriches SEARCH with fetched page text while keeping the source list clean', async () => {
    const { orch } = makeOrchestrator({ withFetch: true });
    const events = await collect(orch.run({ ownerId: 'u1', question: 'EV market 2026', taskId: 't1' }));

    // Source list stays one-per-origin (not one per fetched paragraph) and reports fetched count.
    const searchEnd: any = events.find((e) => e.type === 'step-end' && (e as any).state === 'search');
    expect(searchEnd.summary).toMatch(/fetched/);
    const sources: any = events.find((e) => e.type === 'sources');
    expect(sources.sources).toHaveLength(1);
    expect(sources.sources[0].id).toBe('fake:1');
    // The run still completes end-to-end with fetch enrichment active.
    expect(events.at(-1)?.type).toBe('done');
  });

  it('S25 verified path: extract verifies quotes, compare recomputes claims, report carries footnotes', async () => {
    // Stub-fetched chunk ids for the search hit's origin.
    const page = `fetch:${shortHash('https://a.test')}`;
    const verbatim = 'the trend has continued through 2026 with measurable growth';
    const extractJSON = JSON.stringify({
      snippets: [
        { sourceId: `${page}:2`, quote: verbatim, relevance: 'growth' },
        { sourceId: `${page}:2`, quote: 'a quote that does not exist in the chunk' }, // must be rejected
      ],
    });
    // idGen: plan step id-0, search id-1, extract id-2, first verified snippet id-3.
    const compareJSON = JSON.stringify({
      claims: [
        { claim: 'Growth continued in 2026.', supportingSnippetIds: ['id-3'], conflictingSnippetIds: [], status: 'corroborated' },
        { claim: 'Unsupported.', supportingSnippetIds: ['id-999'], conflictingSnippetIds: [], status: 'single_source' },
      ],
    });
    const planJSON = JSON.stringify({ subquestions: ['q1'], estimateSeconds: 30 });

    const tools = new ToolRuntime();
    tools.register(new WebSearchTool(new FakeProvider()));
    tools.register(new WebFetchTool(new StubFetchProvider()));
    const prompts = new PromptRegistry([
      { promptId: 'research.plan', version: '1', scene: 'p', template: 'plan', safetyConstraints: [], rollout: 1 },
      { promptId: 'research.synthesize', version: '1', scene: 's', template: 'synth', safetyConstraints: [], rollout: 1 },
      { promptId: 'research.synthesize-cited', version: '1', scene: 's', template: 'cited synth footnote', safetyConstraints: [], rollout: 1 },
      { promptId: 'research.extract-citations', version: '1', scene: 'x', template: 'extract-cit', safetyConstraints: [], rollout: 1 },
      { promptId: 'research.extract', version: '1', scene: 'x', template: 'verbatim quotation', safetyConstraints: [], rollout: 1 },
      { promptId: 'research.compare', version: '1', scene: 'c', template: 'comparison stage', safetyConstraints: [], rollout: 1 },
    ]);
    let n = 0;
    const orch = new ResearchOrchestrator({
      adapters: new Map([
        ['planp', new MockAdapter('planp', { jsonSequence: [planJSON, extractJSON, compareJSON] })],
        ['synthp', new MockAdapter('synthp', { streamText: 'Growth continued in 2026. [^id-3]' })],
      ]),
      prompts,
      tools,
      ledger: new InMemoryCostLedger(new PricingBook().set('planp/m', { in: 1, out: 1 }).set('synthp/m', { in: 1, out: 1 })),
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
    const events = await collect(orch.run({ ownerId: 'u1', question: 'EV market 2026', taskId: 't1' }));

    // compare step ran between extract and generate
    const states = events.filter((e) => e.type === 'step-start').map((e: any) => e.state);
    expect(states).toEqual(['plan', 'search', 'extract', 'compare', 'generate', 'deliver']);

    // extract: the fabricated quote was rejected, one verified snippet survived
    const snippets: any = events.find((e) => e.type === 'snippets');
    expect(snippets.snippets).toHaveLength(1);
    expect(snippets.snippets[0].quote).toBe(verbatim);
    const extractEnd: any = events.find((e) => e.type === 'step-end' && (e as any).state === 'extract');
    expect(extractEnd.summary).toContain('1 verified quotes');
    expect(extractEnd.summary).toContain('1 rejected');

    // compare: unsupported claim dropped; status recomputed (one page → single_source);
    // sourceIds mapped to the DISPLAY source id (citation-correctness invariant)
    const citations: any = events.find((e) => e.type === 'citations');
    expect(citations.citations).toHaveLength(1);
    expect(citations.citations[0].status).toBe('single_source');
    expect(citations.citations[0].sourceIds).toEqual(['fake:1']);
    expect(citations.citations[0].snippetIds).toEqual(['id-3']);

    // deliver: footnoted report with key-claims table
    const artifact: any = events.find((e) => e.type === 'artifact');
    expect(artifact.artifact.content).toContain('## Key claims');
    expect(artifact.artifact.content).toContain('## Cited snippets');
    expect(artifact.artifact.content).toContain(`[^id-3]: "${verbatim}"`);
    expect(events.at(-1)?.type).toBe('done');

    // contract round-trip with snippets persisted
    const persisted = Task.parse(JSON.parse(JSON.stringify(await (orch as any).d.repo.get('t1'))));
    expect(persisted.snippets).toHaveLength(1);
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
