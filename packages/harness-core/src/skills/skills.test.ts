import { describe, it, expect } from 'vitest';
import type { ModelAlias, RouteConfig, SkillDef, Task } from '@apolla/contracts';
import { SkillRuntime } from './runtime';
import { makeGenericExecutor } from './executors';
import { autoDraftSkill } from './autodraft';
import { ModelRouter } from '../router/router';
import { MockAdapter } from '../router/mock';
import { PromptRegistry } from '../prompts/registry';
import { ToolRuntime } from '../tools/runtime';
import { WebSearchTool, type SearchProvider, type SearchHit } from '../tools/search';
import { CompositeSkillSource, InMemorySkillRepository } from '../repo/memory';
import type { TaskEvent } from '../orchestrator/events';

class FakeProvider implements SearchProvider {
  readonly name = 'fix';
  async search(): Promise<SearchHit[]> {
    return [{ title: 'Doc', url: 'https://x', snippet: 'evidence' }];
  }
}

const summarizeSkill: SkillDef = {
  name: 'summarize-url',
  triggers: ['summarize', 'tl;dr'],
  tools: ['web_search'],
  io: {},
  risk: 'read',
  promptRef: 'summarize',
  executor: 'generic',
};

function buildRuntime() {
  const router = new ModelRouter({
    adapters: new Map([['m', new MockAdapter('m', { text: '- point one\n- point two' })]]),
    env: { K: 'k' },
    routeFor: (alias: ModelAlias): RouteConfig => ({ alias, primary: 'm/x', fallbackChain: [], keyPool: ['K'] }),
  });
  const prompts = new PromptRegistry([
    { promptId: 'summarize', version: '1', scene: 's', template: 'Summarize.', safetyConstraints: [], rollout: 1 },
  ]);
  const tools = new ToolRuntime();
  tools.register(new WebSearchTool(new FakeProvider()));
  const userSkills = new InMemorySkillRepository();
  const source = new CompositeSkillSource([summarizeSkill], userSkills);
  const runtime = new SkillRuntime(source, makeGenericExecutor({ router, prompts, tools }));
  return { runtime, userSkills };
}

async function collect(it: AsyncIterable<TaskEvent>): Promise<TaskEvent[]> {
  const out: TaskEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

describe('SkillRuntime', () => {
  it('matches a skill by its triggers', async () => {
    const { runtime } = buildRuntime();
    const hits = await runtime.match('please summarize this page');
    expect(hits.map((s) => s.name)).toContain('summarize-url');
  });

  it('runs a generic skill end-to-end (evidence + streamed output)', async () => {
    const { runtime } = buildRuntime();
    const skill = (await runtime.get('summarize-url'))!;
    const events = await collect(runtime.run(skill, { ownerId: 'u1', question: 'summarize EVs' }));
    const types = events.map((e) => e.type);
    expect(types).toContain('sources');
    expect(types).toContain('delta');
    expect(types.at(-1)).toBe('done');
    const text = events.filter((e) => e.type === 'delta').map((e: any) => e.text).join('');
    expect(text).toContain('point one');
  });

  it('surfaces a user-saved skill alongside built-ins', async () => {
    const { runtime, userSkills } = buildRuntime();
    await userSkills.save('u1', { ...summarizeSkill, name: 'my-skill', triggers: ['myskill'] });
    expect((await runtime.list('u1')).map((s) => s.name)).toEqual(['summarize-url', 'my-skill']);
  });
});

describe('autoDraftSkill', () => {
  const baseTask: Task = {
    id: 't1',
    type: 'research',
    state: 'done',
    ownerId: 'u1',
    question: 'State of the EV market in 2026',
    steps: [{ id: 's', state: 'search', costUsd: 0 }],
    sources: [],
    citations: [],
    artifacts: [],
    totalCostUsd: 0,
    replayable: true,
  };

  it('drafts a reusable research skill from a completed task', () => {
    const skill = autoDraftSkill(baseTask)!;
    expect(skill.name.startsWith('research-')).toBe(true);
    expect(skill.executor).toBe('research');
    expect(skill.tools).toContain('web_search');
    expect(skill.promptRef).toBe('research.synthesize');
  });

  it('returns null for an unfinished task', () => {
    expect(autoDraftSkill({ ...baseTask, state: 'generate' })).toBeNull();
  });
});
