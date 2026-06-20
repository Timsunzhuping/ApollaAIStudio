import {
  InMemoryMemory,
  InMemoryCostLedger,
  InMemoryTaskRepository,
  PromptRegistry,
  ToolRuntime,
  WebSearchTool,
  ResearchOrchestrator,
  MockAdapter,
  autoDraftSkill,
  type SearchProvider,
  type SearchHit,
} from '@apolla/harness-core';
import type { TaskEvent } from '@apolla/harness-core';
import type { ModelAlias, RouteConfig } from '@apolla/contracts';
import { runGolden } from './golden';
import type { CheckResult } from './checks';

class FixtureProvider implements SearchProvider {
  readonly name = 'fix';
  async search(): Promise<SearchHit[]> {
    return [{ title: 'Doc', url: 'https://x', snippet: 'evidence' }];
  }
}

/** ④ Memory recall: a relevant note is recalled; an unrelated one is not surfaced first. */
export async function memoryRecallScenario(): Promise<CheckResult> {
  const mem = new InMemoryMemory();
  await mem.note({ ownerId: 'u', content: 'The EV battery market grew in 2026.' });
  await mem.note({ ownerId: 'u', content: 'A pasta recipe that uses fresh basil.' });
  const hits = await mem.recall('u', 'electric vehicle battery');
  const ok = hits.length > 0 && (hits[0]?.content.toLowerCase().includes('battery') ?? false);
  return { name: 'memory-recall', ok, issues: ok ? [] : ['failed to recall the EV battery note'] };
}

/** ⑤ Skill autodraft quality: a completed research task drafts a valid, reusable research skill. */
export async function autoDraftScenario(): Promise<CheckResult> {
  const { task } = await runGolden();
  const skill = autoDraftSkill(task);
  const issues: string[] = [];
  if (!skill) issues.push('autoDraft returned null');
  else {
    if (skill.executor !== 'research') issues.push('executor is not "research"');
    if (skill.promptRef !== 'research.synthesize') issues.push('promptRef is wrong');
    if (!skill.tools.includes('web_search')) issues.push('missing web_search tool');
  }
  return { name: 'skill-autodraft', ok: issues.length === 0, issues };
}

/** ⑥ Personalization: the user model is injected into the plan call's system (instruction) channel. */
export async function personalizationScenario(): Promise<CheckResult> {
  const memory = new InMemoryMemory();
  await memory.setUserModel('u', { language: 'Chinese', style: 'bulleted' });

  const tools = new ToolRuntime();
  tools.register(new WebSearchTool(new FixtureProvider()));
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
    env: { K: 'k' },
    idGen: () => `id-${n++}`,
    routeFor: (alias: ModelAlias): RouteConfig => ({
      alias,
      primary: alias === 'gpt_premium' ? 'planp/m' : 'synthp/m',
      fallbackChain: [],
      keyPool: ['K'],
    }),
  });

  for await (const _e of orch.run({ ownerId: 'u', question: 'EV market', taskId: 't1' })) void (_e as TaskEvent);

  const planSystem = planMock.reqs[0]?.messages.find((m) => m.role === 'system')?.content ?? '';
  const ok = planSystem.includes('Chinese') && planSystem.includes('bulleted');
  return { name: 'personalization-injection', ok, issues: ok ? [] : ['user model not injected into the plan system channel'] };
}

export async function runScenarios(): Promise<CheckResult[]> {
  return Promise.all([memoryRecallScenario(), autoDraftScenario(), personalizationScenario()]);
}
